#!/usr/bin/env python3
"""Structural gate: only an explicit owner action may bring a backend window forward.

Automatic routing, reconnection and progress/health polling run while the owner
is using another application. Measured 2026-09-20 with Codex Desktop already
running, `/usr/bin/open -g -b com.openai.codex` exited 0 and still moved the
foreground onto Codex: `open -b` delivers a reopen Apple Event and Desktop
answers it by showing and focusing its window, while `-g` only suppresses
`open`'s own activation. Automatic paths therefore must not call it at all.

This is source-level; it runs no model, opens no application and changes no
foreground. `scripts/observe-execution-focus.swift` and
`scripts/verify-focus-ownership.swift` cover the observable side separately.
"""
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
app = (root / 'Sources/OS1App/OS1App.swift').read_text()
browser = (root / 'Sources/OS1App/BrowserPanel.swift').read_text()
main = (root / 'Sources/OS1/main.swift').read_text()
transport = (root / 'Sources/OS1/CodexDesktopTransport.swift').read_text()
policy = (root / 'Sources/OS1Context/BackendWindowFocus.swift').read_text()
swift_sources = {
    path.relative_to(root).as_posix(): path.read_text()
    for path in sorted((root / 'Sources').rglob('*.swift'))
}
checks = 0


def check(value, message):
    global checks
    assert value, message
    checks += 1


# 1. The policy itself: exactly one foreground-eligible intent.
check('case explicitUserReveal = "explicit_user_reveal"' in policy, 'explicit reveal intent')
check('case automaticBackendWork = "automatic_backend_work"' in policy, 'automatic work intent')
check('intent == .explicitUserReveal' in policy, 'only an explicit reveal may activate a backend window')
check('public static let backgroundLaunchOptions = ["-g", "-b"]' in policy, 'background launch options are pinned')

# 2. The transport never reopens a running owner.
check('launch: BackendWindowFocus.DesktopLaunch,' in transport,
      'ensureRunning takes the typed launch decision from the caller')
check('guard launch == .backgroundLaunch else { return }' in transport,
      'a running Desktop owner is never launched or reopened')
check(transport.index('guard launch == .backgroundLaunch else { return }') < transport.index('URL(fileURLWithPath: "/usr/bin/open")'),
      'the running-owner guard must precede any open invocation')
check('BackendWindowFocus.backgroundLaunchOptions + [desktopBundleID]' in transport,
      'cold launch arguments come from the single focus policy')
check('codex://threads/' not in transport, 'the transport never sends an activating thread URL')

# 3. The single automatic caller passes the policy decision.
check('launch: BackendWindowFocus.desktopLaunch(isRunning: codexDesktopIsRunning())' in main,
      'automatic Codex routing asks the focus policy before launching')
# Every call site must state a launch decision; none may default to launching.
ensure_calls = re.findall(r'CodexDesktopTransport\.ensureRunning\([^)]*\)', main, re.S)
check(len(ensure_calls) >= 1, 'the Desktop routing path still ensures an owner')
for call in ensure_calls:
    check('launch:' in call, f'ensureRunning call without an explicit launch decision: {call}')
check(sum('BackendWindowFocus.desktopLaunch' in call for call in ensure_calls) == 1,
      'exactly one routing call derives its launch decision from the focus policy')

# 4. Both native reveals are gated on the same policy, not on an ad-hoc mode test.
check(main.count('guard BackendWindowFocus.mayActivateBackendWindow(mode.focusIntent) else {') == 2,
      'Codex and Claude reveal both gate on the focus policy')
check('self == .always ? .explicitUserReveal : .automaticBackendWork' in main,
      'only --desktop-reveal always counts as an explicit reveal')
check('"--desktop-reveal", "background",' in app, 'the app routes with record-only desktop visibility')

# 5. OS-1 must not compensate by pinning itself above other applications.
for forbidden in ['activateIgnoringOtherApps', 'orderFrontRegardless', 'NSApp.activate',
                  'NSApplication.shared.activate', 'NSWindow.Level', '.floatingPanel',
                  'level = .floating', 'hidesOnDeactivate']:
    for name, source in swift_sources.items():
        check(forbidden not in source, f'{name} must not pin a window above other apps ({forbidden})')

# 6. Every call that can bring an application forward is a known, explicit site.
# A new one changes this list and has to be reviewed against the policy above.
allowed = {
    'Sources/OS1App/BrowserPanel.swift': {
        'Button { if let url = BrowserNavigation.url(page.address) { NSWorkspace.shared.open(url) } }',
    },
    'Sources/OS1App/OS1App.swift': {
        # Self-test of the explicit rails; the opener is a recording stub.
        'store.openInCodexDesktop()',
        'store.openInClaudeDesktop()',
        # Default opener, reached only from openLinkedNativeSession.
        'nativeSessionOpener: @escaping NativeSessionOpener = { NSWorkspace.shared.open($0) }',
        'func openInCodexDesktop() {',
        'func openInClaudeDesktop() {',
        # Owner-pressed controls.
        'if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders") { NSWorkspace.shared.open(url) }',
        'if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles") { NSWorkspace.shared.open(url) }',
        'Button(os1Tr("설치된 OS-1 앱 표시", "Reveal installed OS-1 app")) { NSWorkspace.shared.activateFileViewerSelecting([Bundle.main.bundleURL]) }',
        'if provider == .claude { store.openInClaudeDesktop() }',
        'else { store.openInCodexDesktop() }',
        'NSWorkspace.shared.open(latest.sourceURL)',
        'Button("Open in Codex Desktop") { store.openInCodexDesktop() }',
        'Button("Open in Claude Desktop") { store.openInClaudeDesktop() }',
    },
    'Sources/OS1/CodexDesktopTransport.swift': {
        'URL(fileURLWithPath: "/usr/bin/open"),',
    },
    'Sources/OS1/main.swift': {
        # revealInCodexDesktop / revealInClaudeDesktop: explicit reveal only.
        'let result = try commandOutput("/usr/bin/open", [url], timeout: 15)',
        '"/usr/bin/open",',
        # Self-test assertion for the injected cold-start launcher.
        'automaticLaunches[0].0.path == "/usr/bin/open",',
    },
}
pattern = re.compile(r'NSWorkspace\.shared\.open\(|NSWorkspace\.shared\.activateFileViewerSelecting|'
                     r'/usr/bin/open|openInCodexDesktop\(\)|openInClaudeDesktop\(\)')
for relative, text in swift_sources.items():
    permitted = allowed.get(relative, set())
    for number, line in enumerate(text.splitlines(), start=1):
        stripped = line.strip()
        if not pattern.search(stripped) or stripped.startswith('//') or stripped.startswith('///'):
            continue
        assert stripped in permitted, f'unreviewed foreground call {relative}:{number}: {stripped}'
        checks += 1

# 7. The one intentional foreground change that is not a backend window: the
# official Claude sign-in dialog. It is an owner-blocking credential prompt
# reached only after a real authentication failure, and only that launcher may
# activate. Keeping it pinned here stops the pattern from spreading.
check(main.count('tell me to activate') == 1,
      'exactly one activating dialog is allowed, the official Claude sign-in')
check('claude auth login' in main[:main.index('tell me to activate')],
      'the activating dialog belongs to the official sign-in flow')

# 8. The explicit reveals stay reachable, so the owner can still open a backend.
check('func revealInCodexDesktop(threadID: String) throws {' in main, 'explicit Codex reveal preserved')
check('func revealInClaudeDesktop(' in main, 'explicit Claude reveal preserved')
check('Button("Open in Codex Desktop") { store.openInCodexDesktop() }' in app, 'owner control preserved')
check('Button("Open in Claude Desktop") { store.openInClaudeDesktop() }' in app, 'owner control preserved')

print(f'Backend window focus: {checks} structural checks PASS '
      '(running owner never reopened, reveal gated on explicit intent, no always-on-top, '
      'no unreviewed foreground call)')
sys.exit(0)
