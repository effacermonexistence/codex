import Foundation

/// Resource verification has its own bounded observer budget. Loading a large
/// sealed bundle is not a provider request and does not change Gateway RPC,
/// task/model deadlines, authentication or the signature verification rules.
public enum InstalledResourceSeal {
    public enum Failure: Error, Equatable { case rejected, timeout }
    public static let verificationTimeout = 60

    /// Production supplies its existing bounded process executor. Tests supply
    /// only an offline result/clock; no executable path or verification flags
    /// can be selected by a model, prompt or configuration.
    public static func verify(app: URL,
                              uptime: () -> TimeInterval = { ProcessInfo.processInfo.systemUptime },
                              execute: (String, [String], Int) throws -> Int32) throws {
        let began = uptime()
        guard began.isFinite else { throw Failure.timeout }
        let status = try execute("/usr/bin/codesign", ["--verify", "--deep", "--strict", app.path],
                                 verificationTimeout)
        let elapsed = uptime() - began
        // The process executor enforces the timeout while it runs. A delayed
        // completion observation must not turn an expired verification into
        // a valid signature result either.
        guard elapsed.isFinite, elapsed >= 0, elapsed < TimeInterval(verificationTimeout) else { throw Failure.timeout }
        guard status == 0 else { throw Failure.rejected }
    }
}
