import Foundation

/// Which OS-1 paths may take the macOS foreground for a backend application.
///
/// A backend (Codex Desktop, Claude Desktop) is an execution owner, not a
/// surface the owner asked to look at. Automatic routing, retries, backend
/// reconnection and progress/health polling all run while the owner is using
/// some other application, so none of them may pull a backend window in front
/// of it. Only an explicit owner action — the "open in Codex/Claude" controls —
/// may activate a backend window.
///
/// The repair belongs at the source of the activation. OS-1 never pins its own
/// window above other applications to compensate: that takes the foreground
/// away from the owner just as badly, in the other direction.
public enum BackendWindowFocus {
    public enum Intent: String, Codable, Sendable, CaseIterable {
        /// The owner pressed a control that asks for the native application.
        case explicitUserReveal = "explicit_user_reveal"
        /// Routing, retry, reconnection, progress/health polling, self-update.
        case automaticBackendWork = "automatic_backend_work"
    }

    public static func mayActivateBackendWindow(_ intent: Intent) -> Bool {
        intent == .explicitUserReveal
    }

    /// What OS-1 must do to reach a Desktop execution owner.
    public enum DesktopLaunch: String, Codable, Sendable, Equatable {
        /// The owner already runs: use its IPC socket and send nothing else.
        ///
        /// `/usr/bin/open -b <bundle id>` is not a no-op for a running app: it
        /// delivers a reopen Apple Event, and Desktop answers that event by
        /// showing and focusing its window. `-g` suppresses only `open`'s own
        /// activation request, never the application's reopen handler, so an
        /// automatic route must not send it at all. Measured on 2026-09-20
        /// with Codex Desktop (`com.openai.codex`) already running: `open -g -b`
        /// exited 0 and moved the foreground off the owner's frontmost app.
        case useRunningOwner = "use_running_owner"
        /// Not running: a cold launch carries no reopen event, so `-g` does
        /// keep the new process out of the foreground.
        case backgroundLaunch = "background_launch"
    }

    public static func desktopLaunch(isRunning: Bool) -> DesktopLaunch {
        isRunning ? .useRunningOwner : .backgroundLaunch
    }

    /// Exactly the `/usr/bin/open` options a background launch may use. The
    /// bundle identifier is appended by the caller. An activating form (`open
    /// <url>`, `open -a`, `open` without `-g`) is reserved for explicit reveal.
    public static let backgroundLaunchOptions = ["-g", "-b"]
}
