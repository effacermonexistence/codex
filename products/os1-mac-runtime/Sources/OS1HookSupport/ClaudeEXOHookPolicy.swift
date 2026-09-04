import Darwin
import Foundation

public enum ClaudeEXOHookPolicy {
    // Leave a cushion between the internal deadline and Claude Code's process
    // timeout so EXO has time to remove any placement it created.
    public static let operationTimeoutSeconds: TimeInterval = 30
    public static let commandTimeoutSeconds = 35
    public static let failureCooldownSeconds: TimeInterval = 60
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
