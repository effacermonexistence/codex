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
    public static let internalProviderEnvironmentKey = "OS1_INTERNAL_PROVIDER_EXECUTION"

    public static func shouldBypass(
        cwd: String,
        homeDirectory: String,
        environment: [String: String]
    ) -> Bool {
        environment[internalProviderEnvironmentKey] == "1" ||
            isExecutorWorkspace(cwd: cwd, homeDirectory: homeDirectory)
    }

    public static func isExecutorWorkspace(cwd: String, homeDirectory: String) -> Bool {
        let home = URL(fileURLWithPath: homeDirectory, isDirectory: true).resolvingSymlinksInPath().path
        let workspace = URL(fileURLWithPath: cwd, isDirectory: true).resolvingSymlinksInPath().path
        let executorRoot = home + "/.os1/fleet/jobs/"
        return (workspace + "/").hasPrefix(executorRoot)
    }
}

/// Feasibility gate for automatic Fleet dispatch and EXO drafting. A prompt
/// that the host harness synthesized, or one that only makes sense inside the
/// surrounding conversation, cannot execute as a standalone remote job; the
/// safe outcome is ordinary foreground execution, never a remote job the
/// assistant is then told to wait for.
public enum PromptIntentPolicy {
    public enum Decision: Equatable {
        case dispatch
        case harnessGenerated
        case notStandalone
    }

    /// Blocks that Claude Code / Codex inject through the prompt channel.
    public static let harnessMarkers = [
        "<task-notification>", "<system-reminder>", "<command-message>", "<command-name>",
        "<ci-monitor-event>", "<local-command-caveat>", "<local-command-stdout>",
        "<<autonomous-loop", "[SYSTEM NOTIFICATION", "<skill-format>",
    ]

    /// Whole-prompt continuation phrases that depend on prior turns.
    public static let continuationPhrases: Set<String> = [
        "계속", "계속해", "계속해줘", "계속 진행해", "계속진행해", "진행해", "진행해줘", "이어서", "이어서 해줘",
        "다음", "다음 단계", "다시", "다시 해봐", "다시해", "재시도", "네", "응", "그래", "좋아", "ㅇㅇ", "ㄱㄱ",
        "continue", "go on", "go ahead", "proceed", "next", "ok", "okay", "yes", "yep", "sure", "again", "retry",
        "resume", "keep going", "carry on", "do it", "go",
    ]

    /// Prompts that open with a reference to something not contained in the text.
    public static let deicticLeads = [
        "그거", "그건", "그걸", "이거", "이건", "이걸", "저거", "방금", "아까", "위에", "위의", "위 ", "그 파일", "이 파일",
        "그 코드", "이 코드", "그 결과", "이 결과", "그 세션", "that ", "this ", "those ", "these ", "it ", "the above",
        "as before", "same as", "like before", "the previous", "the last",
    ]

    public static let minimumStandaloneCharacters = 24
    public static let deicticMaximumCharacters = 160

    public static func isHarnessGenerated(_ prompt: String) -> Bool {
        let head = String(prompt.trimmingCharacters(in: .whitespacesAndNewlines).prefix(4_000))
        return harnessMarkers.contains { head.contains($0) }
    }

    public static func isStandaloneTask(_ prompt: String) -> Bool {
        let trimmed = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalized = trimmed.lowercased()
            .trimmingCharacters(in: CharacterSet(charactersIn: ".!?~…。,;:'\"()[]"))
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        guard !normalized.isEmpty, !continuationPhrases.contains(normalized) else { return false }
        guard trimmed.count >= minimumStandaloneCharacters else { return false }
        if trimmed.count <= deicticMaximumCharacters,
           deicticLeads.contains(where: { normalized.hasPrefix($0.lowercased()) }) {
            return false
        }
        return true
    }

    public static func decision(for prompt: String) -> Decision {
        if isHarnessGenerated(prompt) { return .harnessGenerated }
        if !isStandaloneTask(prompt) { return .notStandalone }
        return .dispatch
    }
}

/// A local EXO draft is only worth the consumer's context window when it says
/// something specific. Greetings, refusals and one-liners are dropped.
public enum EXODraftPolicy {
    public static let minimumCharacters = 40
    public static let genericPatterns = [
        "안녕하세요", "감사합니다", "답변해 드릴 수 있습니다", "도와드릴", "무엇을 도와", "how can i help",
        "i can help", "hello!", "thank you for", "as an ai", "i'm sorry", "i am sorry", "죄송",
    ]

    public static func isUseful(_ output: String) -> Bool {
        let trimmed = output.trimmingCharacters(in: .whitespacesAndNewlines)
        let substantive = trimmed.filter { !$0.isWhitespace }
        guard substantive.count >= minimumCharacters else { return false }
        let lowered = trimmed.lowercased()
        let generic = genericPatterns.filter { lowered.contains($0) }.count
        // Two or more canned phrases in a short draft is boilerplate, not a draft.
        return !(generic >= 2 && substantive.count < 400) && !(generic >= 1 && substantive.count < 120)
    }
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
