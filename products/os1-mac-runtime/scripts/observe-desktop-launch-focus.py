#!/usr/bin/env python3
"""Measure whether reaching the Codex Desktop owner moves the macOS foreground.

Compiles the real `Sources/OS1/CodexDesktopTransport.swift` against the built
OS1Context module and calls `ensureRunning` with exactly the decision the
runtime computes, while observing `NSWorkspace.didActivateApplicationNotification`.
No model is called, no thread is opened, no turn is started.

  --include-legacy   Also reproduce the pre-fix call (`/usr/bin/open -g -b
                     com.openai.codex`). That call is the bug: it delivers a
                     reopen Apple Event to a running Desktop and takes the
                     foreground. Opt-in, because running it moves the owner's
                     frontmost application.

Usage: observe-desktop-launch-focus.py report.json [--include-legacy]
An already-frontmost backend cannot be observed activating, so that case is
reported as UNKNOWN rather than a vacuous PASS.
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
build = root / '.build/debug'
if len(sys.argv) < 2:
    raise SystemExit('usage: observe-desktop-launch-focus.py report.json [--include-legacy]')
report_path = Path(sys.argv[1]).resolve()
include_legacy = '--include-legacy' in sys.argv[2:]

driver = '''import AppKit
import Foundation
import OS1Context

let includeLegacy = CommandLine.arguments.contains("--include-legacy")
var events: [[String: String]] = []
let initial = NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? "unknown"
let observer = NSWorkspace.shared.notificationCenter.addObserver(
    forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { note in
    guard let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
    events.append(["bundleID": app.bundleIdentifier ?? "unknown",
                   "at": ISO8601DateFormatter().string(from: Date())])
}
defer { NSWorkspace.shared.notificationCenter.removeObserver(observer) }
func settle(_ seconds: TimeInterval) { RunLoop.current.run(until: Date().addingTimeInterval(seconds)) }
func running() -> Bool {
    !NSRunningApplication.runningApplications(withBundleIdentifier: CodexDesktopTransport.desktopBundleID).isEmpty
}
func front() -> String { NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? "unknown" }

// A record-only thread identity; nothing is opened, resumed or started.
let threadID = "0f9b2c68-49cf-4f2f-9a6e-2b0cd1a4f7e3"
var phases: [[String: Any]] = []
settle(0.5)

let wasRunning = running()
let decision = BackendWindowFocus.desktopLaunch(isRunning: wasRunning)
let before = front(), mark = events.count
var failure: String? = nil
do {
    try CodexDesktopTransport.ensureRunning(threadID: threadID,
        launch: decision == .backgroundLaunch)
} catch { failure = String(describing: error) }
settle(4)
phases.append(["phase": "current_policy", "desktopWasRunning": wasRunning,
               "decision": decision.rawValue, "launched": decision == .backgroundLaunch,
               "error": failure ?? "none",
               "foregroundBefore": before, "foregroundAfter": front(),
               "activations": Array(events.dropFirst(mark))])

let current = phases.last!

// The pre-fix call, reproduced verbatim, runs last so it cannot contaminate the
// measurement above. It is expected to take the foreground: that is the bug.
if includeLegacy {
    let legacyBefore = front(), mark = events.count
    let legacy = Process()
    legacy.executableURL = URL(fileURLWithPath: "/usr/bin/open")
    legacy.arguments = ["-g", "-b", CodexDesktopTransport.desktopBundleID]
    try legacy.run(); legacy.waitUntilExit()
    settle(4)
    phases.append(["phase": "legacy_open_g_b", "desktopWasRunning": running(),
                   "exitStatus": Int(legacy.terminationStatus),
                   "foregroundBefore": legacyBefore, "foregroundAfter": front(),
                   "activations": Array(events.dropFirst(mark))])
}

let watched: Set<String> = ["com.openai.codex", "com.anthropic.claudefordesktop", "com.omaragi.os1"]
let currentActivations = (current["activations"] as! [[String: String]])
    .filter { watched.contains($0["bundleID"] ?? "") }
let blind = watched.contains(initial)
let status: String
if blind { status = "UNKNOWN_WATCHED_APP_ALREADY_FRONTMOST" }
else if failure != nil { status = "REVIEW_ENSURE_RUNNING_FAILED" }
else if !currentActivations.isEmpty || (current["foregroundAfter"] as! String) != before {
    status = "FAIL_FOREGROUND_TAKEN"
} else { status = "PASS" }
let report: [String: Any] = ["status": status, "observable": !blind,
    "modelCalls": 0, "threadsOpened": 0, "turnsStarted": 0,
    "initialForeground": initial, "finalForeground": front(),
    "phases": phases, "backendActivationsUnderCurrentPolicy": currentActivations.count,
    "limitation": "Passive observation. An app already frontmost emits no activation event."]
let data = try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
try data.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: CommandLine.arguments[1])
print("Desktop launch focus: \\(status)")
exit(status == "PASS" ? 0 : 1)
'''

objects = sorted(str(p) for group in ('OS1Context.build', 'OS1System.build')
                 for p in (build / group).glob('*.o'))
if not objects:
    raise SystemExit('Build the package first: swift build')
with tempfile.TemporaryDirectory(prefix='os1-launch-focus-') as temp:
    temp = Path(temp)
    # Top-level statements are only allowed in `main.swift`.
    (temp / 'main.swift').write_text(driver)
    (temp / 'module.modulemap').write_text(
        'module OS1System { header "%s" export * }\n' % (root / 'Sources/OS1System/include/OS1System.h'))
    subprocess.run(['swiftc', str(temp / 'main.swift'),
                    str(root / 'Sources/OS1/CodexDesktopTransport.swift'),
                    '-I', str(build / 'Modules'), '-I', str(temp), *objects,
                    '-o', str(temp / 'probe')], check=True)
    arguments = [str(temp / 'probe'), str(report_path)]
    if include_legacy:
        arguments.append('--include-legacy')
    result = subprocess.run(arguments, capture_output=True, text=True, timeout=120)
print(result.stdout.strip() or result.stderr.strip())
report = json.loads(report_path.read_text())
for phase in report['phases']:
    print(f"  {phase['phase']}: foreground {phase['foregroundBefore']} -> {phase['foregroundAfter']}"
          f" · activations {len(phase['activations'])}")
print(f"Report: {report_path}")
sys.exit(result.returncode)
