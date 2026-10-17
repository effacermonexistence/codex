import Foundation
import OS1Context

/// Regression for the routing focus theft: automatic backend work must never
/// take the macOS foreground, and a Desktop owner that is already running must
/// never receive a launch/reopen request. Measured 2026-09-20 on Codex Desktop
/// (`com.openai.codex`) already running: `/usr/bin/open -g -b com.openai.codex`
/// exited 0 and moved the frontmost application to Codex, because `-g`
/// suppresses only `open`'s own activation, not the app's reopen handler.
func runBackendWindowFocusFixtures() throws {
    var count = 0
    func check(_ value: Bool, _ message: String) {
        precondition(value, "Backend window focus: " + message); count += 1
    }

    // Only an explicit owner reveal may activate a backend window.
    check(BackendWindowFocus.mayActivateBackendWindow(.explicitUserReveal),
          "pressing 'open in Codex/Claude' is allowed to bring the native app forward")
    check(!BackendWindowFocus.mayActivateBackendWindow(.automaticBackendWork),
          "automatic routing, reconnection and progress polling never activate a backend window")
    // Nothing else may be added as a foreground-eligible intent by accident.
    check(BackendWindowFocus.Intent.allCases.filter(BackendWindowFocus.mayActivateBackendWindow) == [.explicitUserReveal],
          "exactly one intent may take the foreground")

    // The launch decision is the actual bug fix.
    check(BackendWindowFocus.desktopLaunch(isRunning: true) == .useRunningOwner,
          "a running Desktop owner is reached over IPC; no reopen event is sent")
    check(BackendWindowFocus.desktopLaunch(isRunning: false) == .backgroundLaunch,
          "a missing Desktop owner is cold-launched instead of left unavailable")
    check(BackendWindowFocus.desktopLaunch(isRunning: true) != .backgroundLaunch,
          "the running case must not fall through to a launch")

    // Cold launch stays out of the foreground and carries no thread URL.
    check(BackendWindowFocus.backgroundLaunchOptions == ["-g", "-b"],
          "background launch keeps -g and targets a bundle identifier, not a URL")
    check(BackendWindowFocus.backgroundLaunchOptions.contains("-g"),
          "a launch without -g would activate the backend")
    check(!BackendWindowFocus.backgroundLaunchOptions.contains("-a"),
          "-a resolves an application path and activates it")

    // Stable wire values: these are written into execution records.
    check(BackendWindowFocus.Intent.explicitUserReveal.rawValue == "explicit_user_reveal",
          "intent wire value is stable")
    check(BackendWindowFocus.Intent.automaticBackendWork.rawValue == "automatic_backend_work",
          "intent wire value is stable")
    check(BackendWindowFocus.DesktopLaunch.useRunningOwner.rawValue == "use_running_owner",
          "launch decision wire value is stable")
    check(BackendWindowFocus.DesktopLaunch.backgroundLaunch.rawValue == "background_launch",
          "launch decision wire value is stable")

    print("Backend window focus: \(count) checks passed; explicit reveal only, running owner never reopened, background launch options")
}
