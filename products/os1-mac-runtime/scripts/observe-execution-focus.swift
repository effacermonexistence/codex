import AppKit

// Passive wrapper around an explicit test command. Never activates an app or
// sends user input. A user-initiated activation is recorded, not corrected.
let arguments = Array(CommandLine.arguments.dropFirst())
guard arguments.count >= 2 else { fatalError("output.json executable [arguments]") }
let reportURL = URL(fileURLWithPath: arguments[0])
let began = Date()
let initial = NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? "unknown"
var events: [[String: String]] = []
let observer = NSWorkspace.shared.notificationCenter.addObserver(
    forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
) { notification in
    guard let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
    events.append(["bundleID": app.bundleIdentifier ?? "unknown",
                   "at": ISO8601DateFormatter().string(from: Date())])
}
defer { NSWorkspace.shared.notificationCenter.removeObserver(observer) }
let process = Process()
process.executableURL = URL(fileURLWithPath: arguments[1])
process.arguments = Array(arguments.dropFirst(2))
process.standardOutput = FileHandle.standardOutput
process.standardError = FileHandle.standardError
try process.run()
while process.isRunning && Date().timeIntervalSince(began) < 360 {
    RunLoop.current.run(until: Date().addingTimeInterval(0.05))
}
if process.isRunning { process.terminate() }
process.waitUntilExit()
RunLoop.current.run(until: Date().addingTimeInterval(2))
let ids: Set<String> = ["com.openai.codex", "com.anthropic.claudefordesktop", "com.omaragi.os1"]
let unexpected = events.filter { ids.contains($0["bundleID"] ?? "") }
let report: [String: Any] = [
    "status": process.terminationStatus == 0 && unexpected.isEmpty ? "PASS" : "REVIEW",
    "exitCode": process.terminationStatus,
    "initialForeground": initial,
    "finalForeground": NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? "unknown",
    "activationEvents": events, "backendOrOS1Activations": unexpected.count,
    "elapsedSeconds": Date().timeIntervalSince(began),
    "limitation": "Passive observation cannot attribute user-initiated activation. No app activation or input is synthesized. Model usage is in the wrapped command's separate audit."
]
try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]).write(to: reportURL)
try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: reportURL.path)
print("Passive execution focus: \(unexpected.count) backend/OS-1 activations. Report: \(reportURL.path)")
exit(process.terminationStatus == 0 && unexpected.isEmpty ? 0 : 1)
