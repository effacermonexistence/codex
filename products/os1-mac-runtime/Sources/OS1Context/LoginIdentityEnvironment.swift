import Foundation

/// The login-identity variables a provider CLI needs to find the user's own
/// sign-in. The Claude CLI looks up its claude.ai credentials in the macOS
/// Keychain under the account named by `USER`; without it, `claude auth
/// status` reports `loggedIn: false` even for a signed-in Max account.
///
/// The OpenClaw gateway starts from a minimal allowlisted environment (no
/// `USER`/`LOGNAME`), and every `os1 rcc-catalog`/`rcc-adapter` it spawns
/// inherited that gap, so Claude and Claude Code were excluded as
/// `signed_out` on every live catalog (observed build 375-379). These are
/// identity names, never credentials.
public enum LoginIdentityEnvironment {
    public static let keys = ["USER", "LOGNAME"]

    /// The variables to add: only keys that are missing or empty, filled with
    /// the effective user's account name. Never overrides a present value.
    public static func missing(in environment: [String: String], userName: String) -> [String: String] {
        guard !userName.isEmpty, !userName.contains("\0"), !userName.contains("=") else { return [:] }
        var additions: [String: String] = [:]
        for key in keys where (environment[key] ?? "").isEmpty { additions[key] = userName }
        return additions
    }

    /// The effective user's account name from the password database, not
    /// from the (possibly empty) environment.
    public static func effectiveUserName() -> String {
        guard let entry = getpwuid(geteuid()), let name = entry.pointee.pw_name else { return NSUserName() }
        return String(cString: name)
    }

    /// Fills the missing login-identity variables in this process so every
    /// provider child inherits them.
    public static func applyToCurrentProcess() {
        for (key, value) in missing(in: ProcessInfo.processInfo.environment, userName: effectiveUserName()) {
            setenv(key, value, 0)
        }
    }
}
