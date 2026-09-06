import Darwin
import Foundation

public enum ClaudeEXOHookPolicy {
    // Leave a cushion between the internal deadline and the host agent's
    // process timeout so EXO has time to remove any placement it created.
    public static let operationTimeoutSeconds: TimeInterval = 60
    public static let commandTimeoutSeconds = 65
    public static let failureCooldownSeconds: TimeInterval = 60
}

public enum AutomaticFleetHookPolicy {
    public static let minimumMemoryMiB = 2_048
    public static let cpuWeight = 50

    public static func isExecutorWorkspace(cwd: String, homeDirectory: String) -> Bool {
        let home = URL(fileURLWithPath: homeDirectory, isDirectory: true).standardizedFileURL.path
        let workspace = URL(fileURLWithPath: cwd, isDirectory: true).standardizedFileURL.path
        let executorRoot = home + "/.os1/fleet/jobs/"
        return (workspace + "/").hasPrefix(executorRoot)
    }
}

public enum ProviderReadinessPolicy {
    public static func canAdvertise(
        executableExists: Bool,
        exitCode: Int32?,
        observedOutput: String?,
        expectedOutput: String
    ) -> Bool {
        guard executableExists,
              exitCode == 0,
              let observedOutput else { return false }
        return observedOutput.trimmingCharacters(in: .whitespacesAndNewlines) == expectedOutput
    }
}

public struct CodexExecJSONResult: Sendable {
    public let threadID: String
    public let output: String
    public let completed: Bool

    public init(threadID: String, output: String, completed: Bool) {
        self.threadID = threadID
        self.output = output
        self.completed = completed
    }
}

public func parseCodexExecJSONL(_ data: Data) -> CodexExecJSONResult? {
    var threadID: String?
    var messages: [String] = []
    var completed = false

    for line in data.split(separator: 0x0A) {
        guard let object = try? JSONSerialization.jsonObject(with: Data(line)) as? [String: Any],
              let type = object["type"] as? String else { continue }
        switch type {
        case "thread.started":
            threadID = object["thread_id"] as? String
        case "item.completed":
            guard let item = object["item"] as? [String: Any],
                  item["type"] as? String == "agent_message",
                  let text = item["text"] as? String else { continue }
            messages.append(text)
        case "turn.completed":
            completed = true
        default:
            continue
        }
    }

    guard let threadID, UUID(uuidString: threadID) != nil,
          completed, let output = messages.last else { return nil }
    return CodexExecJSONResult(threadID: threadID, output: output, completed: completed)
}

public final class ExclusiveHookLease: @unchecked Sendable {
    private let descriptor: Int32

    private init(descriptor: Int32) {
        self.descriptor = descriptor
    }

    public static func tryAcquire(at url: URL) throws -> ExclusiveHookLease? {
        let descriptor = open(url.path, O_CREAT | O_RDWR | O_CLOEXEC, S_IRUSR | S_IWUSR)
        guard descriptor >= 0 else {
            throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
        }
        guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
            let lockError = errno
            close(descriptor)
            if lockError == EWOULDBLOCK || lockError == EAGAIN {
                return nil
            }
            throw POSIXError(POSIXErrorCode(rawValue: lockError) ?? .EIO)
        }
        return ExclusiveHookLease(descriptor: descriptor)
    }

    deinit {
        _ = flock(descriptor, LOCK_UN)
        close(descriptor)
    }
}

public struct HookCircuitBreaker: Sendable {
    private let stateURL: URL
    private let cooldownSeconds: TimeInterval

    public init(stateURL: URL, cooldownSeconds: TimeInterval = ClaudeEXOHookPolicy.failureCooldownSeconds) {
        self.stateURL = stateURL
        self.cooldownSeconds = cooldownSeconds
    }

    public func allowsAttempt(now: Date = Date()) -> Bool {
        guard let data = try? Data(contentsOf: stateURL),
              let value = String(data: data, encoding: .utf8),
              let failureTime = TimeInterval(value.trimmingCharacters(in: .whitespacesAndNewlines)) else {
            return true
        }
        return now.timeIntervalSince1970 - failureTime >= cooldownSeconds
    }

    public func recordFailure(now: Date = Date()) throws {
        let value = Data("\(now.timeIntervalSince1970)\n".utf8)
        try value.write(to: stateURL, options: [.atomic])
    }

    public func recordSuccess() throws {
        guard FileManager.default.fileExists(atPath: stateURL.path) else { return }
        try FileManager.default.removeItem(at: stateURL)
    }
}
