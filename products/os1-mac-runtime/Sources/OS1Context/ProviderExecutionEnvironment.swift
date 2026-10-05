import Foundation

/// Ownership marker for already-dispatched backend children. Fleet prompt hooks
/// must not enqueue the same work again. This is not a permission or auth grant.
///
/// A backend child also must not inherit another agent session's identity. When
/// OS-1 was (re)launched from inside a Claude Code or Codex session, variables
/// such as CLAUDECODE and CLAUDE_CODE_SESSION_ID made the Claude CLI act as that
/// session's child: `auth status` answered loggedIn=false and every Claude run
/// failed as "signed out". OS-1 sets the account it means explicitly
/// (CLAUDE_CONFIG_DIR / CODEX_HOME overrides are applied after this).
public enum ProviderExecutionEnvironment {
    public static func marked(_ inherited: [String: String]) -> [String: String] {
        var environment = inherited.filter { !foreignSessionVariable($0.key) }
        environment["OS1_INTERNAL_PROVIDER_EXECUTION"] = "1"
        return environment
    }

    /// Session identity of an enclosing agent, never user configuration.
    public static func foreignSessionVariable(_ name: String) -> Bool {
        name == "CLAUDECODE" || name.hasPrefix("CLAUDE_CODE_") ||
            ["CODEX_THREAD_ID", "CODEX_SANDBOX", "CODEX_SANDBOX_NETWORK_DISABLED"].contains(name)
    }
}

/// What ties a process to one live OS-1 run: where it reports activity, its
/// run journal, its failure and cancel markers, the submission and
/// conversation it belongs to, the sign-in permission that run was given, and
/// the per-run MCP execution ids. A self-test is a fixture, never part of the
/// run that started it. Staging build 326 ran its self-tests with the
/// conversation's environment, and their fixture activity landed in the
/// owner's live run journal; the fixtures also read the run's cancel marker.
/// (Staging itself still stops on the owner's Stop: its own loop checks it.)
public enum LiveRunEnvironment {
    public static let variables: Set<String> = [
        "OS1_ACTIVITY_FILE", "OS1_EVENT_JOURNAL", "OS1_FAILURE_FILE", "OS1_CANCEL_FILE",
        "OS1_SUBMISSION_ID", "OS1_SUBMISSION_STARTED_AT", "OS1_CONVERSATION_ID",
        "OS1_ALLOW_AUTHENTICATION", "OS1_INTERNAL_PROVIDER_EXECUTION",
        "OS1_CHECKOUT_EXECUTION_ID", "OS1_MEMORY_EXECUTION_ID",
    ]

    public static func removed(from environment: [String: String]) -> [String: String] {
        environment.filter { !variables.contains($0.key) }
    }

    /// Detach this process (a self-test) from any live run it was started in.
    public static func detachCurrentProcess() {
        for key in variables { unsetenv(key) }
    }
}
