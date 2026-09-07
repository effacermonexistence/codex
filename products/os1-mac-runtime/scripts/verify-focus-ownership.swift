import AppKit
import CryptoKit

// Observe real foreground changes while replaying already-adopted results.
// Never activate any app, synthesize input, or regenerate an answer. If the
// user switches apps, preserve that choice and record it rather than restoring.
let args = CommandLine.arguments
guard args.count >= 4 else {
    fatalError("usage: swift verify-focus-ownership.swift runtime output.json deliveryID ...")
}
let runtime = args[1], destination = URL(fileURLWithPath: args[2])
let fileManager = FileManager.default
let box = fileManager.homeDirectoryForCurrentUser
    .appendingPathComponent("Library/Application Support/OS-1/execution-outbox")
func digest(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
func foreground() -> String { NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? "unknown" }
let startForeground = foreground()
var activations: [[String: String]] = []
let observer = NSWorkspace.shared.notificationCenter.addObserver(
    forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
) { notification in
    guard let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
    activations.append(["bundleID": app.bundleIdentifier ?? "unknown", "at": ISO8601DateFormatter().string(from: Date())])
}
defer { NSWorkspace.shared.notificationCenter.removeObserver(observer) }
let temporary = fileManager.temporaryDirectory.appendingPathComponent("os1-focus-probe-\(UUID().uuidString)")
try fileManager.createDirectory(at: temporary, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
defer { try? fileManager.removeItem(at: temporary) }
var replays: [[String: Any]] = []
for (index, id) in args.dropFirst(3).enumerated() {
    precondition(id.range(of: #"^[a-fA-F0-9-]{36}-[0-9]+$"#, options: .regularExpression) != nil)
    let stored = try JSONSerialization.jsonObject(with: Data(contentsOf: box.appendingPathComponent(id + ".json"))) as! [String: Any]
    let step = try JSONSerialization.jsonObject(with: Data(base64Encoded: stored["step"] as! String)!) as! [String: Any]
    let native = step["native_record"] as! [String: Any]
    let transcript = URL(fileURLWithPath: native["record_path"] as! String)
    let before = digest(try Data(contentsOf: transcript))
    let stdoutURL = temporary.appendingPathComponent("\(index).stdout")
    let stderrURL = temporary.appendingPathComponent("\(index).stderr")
    fileManager.createFile(atPath: stdoutURL.path, contents: nil, attributes: [.posixPermissions: 0o600])
    fileManager.createFile(atPath: stderrURL.path, contents: nil, attributes: [.posixPermissions: 0o600])
    let stdout = try FileHandle(forWritingTo: stdoutURL), stderr = try FileHandle(forWritingTo: stderrURL)
    let process = Process()
    process.executableURL = URL(fileURLWithPath: runtime)
    process.arguments = ["resume-delivery", id]
    process.standardOutput = stdout; process.standardError = stderr
    let foregroundBefore = foreground(), started = Date()
    try process.run()
    while process.isRunning && Date().timeIntervalSince(started) < 60 {
        RunLoop.current.run(until: Date().addingTimeInterval(0.05))
    }
    if process.isRunning { process.terminate(); fatalError("Replay exceeded 60 seconds; no model retry attempted") }
    process.waitUntilExit()
    try stdout.close(); try stderr.close()
    precondition(process.terminationStatus == 0, "Replay did not succeed; inspect private local diagnostics")
    let result = try JSONSerialization.jsonObject(with: Data(contentsOf: stdoutURL)) as! [String: Any]
    let received = (result["steps"] as! [[String: Any]])[0]
    let receivedNative = received["native_record"] as! [String: Any]
    precondition(result["status"] as? String == "complete")
    precondition(received["output"] as? String == stored["output"] as? String)
    precondition(received["session_id"] as? String == step["session_id"] as? String)
    precondition(receivedNative["desktop_visibility"] as? String == "native_record_only")
    precondition(receivedNative["persistence"] as? String == "verified")
    let after = digest(try Data(contentsOf: transcript))
    precondition(after == before)
    // Include delayed URL-handler activation, not just process exit.
    RunLoop.current.run(until: Date().addingTimeInterval(2))
    replays.append(["deliveryID": id, "provider": step["provider"] as! String,
        "nativeUnchanged": true, "outputUnchanged": true, "visibility": "native_record_only",
        "foregroundBefore": foregroundBefore, "foregroundAfter": foreground(),
        "elapsedSeconds": Date().timeIntervalSince(started)])
}
let backendIDs: Set<String> = ["com.openai.codex", "com.anthropic.claudefordesktop", "com.omaragi.os1"]
let unexpected = activations.filter { backendIDs.contains($0["bundleID"] ?? "") }
// Same blind spot as the passive wrapper: a watched app already in front
// cannot be observed activating. Report UNKNOWN instead of a vacuous PASS.
let blind = backendIDs.contains(startForeground)
let status = blind ? "UNKNOWN_WATCHED_APP_ALREADY_FRONTMOST" : (unexpected.isEmpty ? "PASS" : "REVIEW_FOREGROUND_EVENTS")
let report: [String: Any] = ["status": status, "observable": !blind,
    "modelCalls": 0, "initialForeground": startForeground, "finalForeground": foreground(),
    "activationEvents": activations, "backendOrOS1Activations": unexpected.count, "replays": replays,
    "limitation": "Passive observation cannot attribute user-initiated activation. Callback regression tests cover explicit vs automatic policy; no physical clicks are simulated."]
try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]).write(to: destination)
try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: destination.path)
print("Focus replay: \(status) — \(replays.count) records, \(unexpected.count) backend/OS-1 activations, 0 model calls. Report: \(destination.path)")
exit(status == "PASS" ? 0 : 1)
if !unexpected.isEmpty { exit(1) }
