import Foundation

/// Wall-clock marks for one provider attempt, so latency work can see where
/// the seconds around a backend turn actually go (lease, backend start,
/// dispatch, turn end, record verification, remote verification).
/// Timings and phase names only: no prompt, output, path or credential.
enum AttemptLatencyTrace {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var started: Date?
    nonisolated(unsafe) private static var marks: [(name: String, seconds: TimeInterval)] = []

    static func begin(at now: Date = Date()) {
        lock.withLock { started = now; marks = [] }
    }

    static func submissionOrigin(_ raw: String?, now: Date) -> Date {
        guard let raw, let seconds = Double(raw), seconds.isFinite else { return now }
        let supplied = Date(timeIntervalSince1970: seconds)
        let age = now.timeIntervalSince(supplied)
        return age >= 0 && age <= 86_400 ? supplied : now
    }

    /// Include GUI submission, native-record ingestion and process launch,
    /// rather than resetting the clock after a hidden preparation stage.
    /// Diagnostic clock only; this never authorizes a route or an action.
    static func beginSubmission(at now: Date = Date()) {
        begin(at: submissionOrigin(ProcessInfo.processInfo.environment["OS1_SUBMISSION_STARTED_AT"], now: now))
        mark("runtime_entered", at: now)
    }

    /// A later attempt of the same task starts its own trace; the first
    /// attempt keeps the task-level marks (policy, routing) before its lease.
    static func beginIfIdle(at now: Date = Date()) {
        lock.withLock { if started == nil { started = now; marks = [] } }
    }

    static func mark(_ name: String, at now: Date = Date()) {
        lock.withLock {
            guard let started, marks.count < 64 else { return }
            marks.append((name, now.timeIntervalSince(started)))
        }
    }

    static func markOnce(_ name: String, at now: Date = Date()) {
        lock.withLock {
            guard let started, marks.count < 64, !marks.contains(where: { $0.name == name }) else { return }
            marks.append((name, now.timeIntervalSince(started)))
        }
    }

    /// Returns the marks of the attempt that began last and clears them.
    static func take() -> [(name: String, seconds: TimeInterval)]? {
        lock.withLock {
            defer { started = nil; marks = [] }
            return started == nil ? nil : marks
        }
    }

    static func finish(executionID: String, sequence: Int, provider: String,
                       root: URL = FileManager.default.homeDirectoryForCurrentUser
                           .appendingPathComponent("Library/Application Support/OS-1/diagnostics", isDirectory: true)) {
        let snapshot = lock.withLock { () -> (Date, [(name: String, seconds: TimeInterval)])? in
            guard let started else { return nil }
            defer { self.started = nil; marks = [] }
            return (started, marks)
        }
        guard let (started, marks) = snapshot, UUID(uuidString: executionID) != nil, (1...16).contains(sequence) else { return }
        let body: [String: Any] = ["schema": 1, "provider": provider, "sequence": sequence,
            "started_at": started.timeIntervalSince1970,
            "marks": marks.map { ["name": $0.name, "ms": Int(($0.seconds * 1_000).rounded())] }]
        guard let data = try? JSONSerialization.data(withJSONObject: body, options: [.sortedKeys]) else { return }
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let path = root.appendingPathComponent("latency-\(executionID.lowercased())-\(sequence).json")
        try? data.write(to: path, options: .atomic)
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path.path)
    }
}
