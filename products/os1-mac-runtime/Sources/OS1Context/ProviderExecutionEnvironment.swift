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
