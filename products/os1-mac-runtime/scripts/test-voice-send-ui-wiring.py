#!/usr/bin/env python3
"""Voice Send is a visible production action, not a fixture-only callback."""
from pathlib import Path

def validate(source):
    primary = source.split('private struct ComposerPrimaryButton: View', 1)[1].split('private struct ComposerView:', 1)[0]
    assert 'if let visibleLabel { Text(visibleLabel)' in primary, 'dictation Send must be visible text, not only tooltip/AX'
    assert 'visibleLabel: voiceLabel' in primary
    assert 'store.performPrimaryAction()' in primary
    assert 'Sending after transcription' in primary and 'Transcribe and send' in primary
    control = source.split('private struct VoiceDictationControl:', 1)[1].split('/// Lifecycle metadata', 1)[0]
    assert 'Transcribe only' in control and 'os1.voice.insert' in control
    assert 'Stop and insert the transcript without sending' in control
    assert '.background(Theme.pink)' not in control, 'insert-only must not masquerade as primary Send'
    store = source.split('private func voiceStoreSendSelfTest()', 1)[1].split('private struct NativeSessionSummary:', 1)[0]
    assert 'store.performPrimaryAction(); store.performPrimaryAction()' in store
    assert 'store.composer == expected' in store and 'store.queuedSubmissions.map(\.request) == [expected]' in store
    assert 'voiceDictation: voice' in store and 'voiceStoreFixtureSendPending' in store
    assert 'voiceStoreSendSelfTest()' in source.split('private func composerInteractionSelfTest()', 1)[1].split('private func composerReturnAction', 1)[0]

source = (Path(__file__).resolve().parents[1] / 'Sources/OS1App/OS1App.swift').read_text()
validate(source)
mutant = source.replace('if let visibleLabel { Text(visibleLabel)', 'if false { Text("hidden")', 1)
try:
    validate(mutant)
except AssertionError:
    pass
else:
    raise AssertionError('tooltip-only voice Send regression was not caught')
print('Voice Send UI wiring: visible primary + distinct insert + real SessionStore activation PASS; hidden-label mutant rejected; microphone/auth/network/model calls 0')

# Verification-observer repair only: preserve the real product/controller and
# the strict browser-success predicate. Mutants must not loosen that predicate,
# widen every wait or publish raw alert/transcript/audio/account content.
import re
import subprocess
import tempfile

def observer_parts(source):
    section = source.split('private func voiceStoreSendSelfTest()', 1)[1].split('private struct NativeSessionSummary:', 1)[0]
    observer = section[section.index('    func wait('):section.index('    func event(')]
    browser = section.split('"browser final dispatch", timeout: 20,', 1)[1].split('        let posts = await wire.postRequests(), connections', 1)[0]
    return section, observer, browser

def validate_observer(source):
    section, observer, browser = observer_parts(source)
    assert 'timeout: TimeInterval = 4' in observer
    assert 'guard timeout.isFinite, timeout > 0, timeout <= 20 else {' in observer
    assert 'Date().addingTimeInterval(timeout)' in observer
    assert section.count('timeout: 20') == 1
    assert 'try await wait({ !voice.isActive && dispatch.requests.count == 1 && !store.isRunning }, "browser final dispatch", timeout: 20,' in section
    assert 'failure: { store.alertMessage != nil }' in browser
    assert 'alert_present=\\(store.alertMessage != nil)' in browser
    assert 'controller_error=' not in browser
    assert 'if failure?() == true' in observer and 'Voice store fixture error:' in observer
    assert 'Voice store deadline:' in observer and 'await diagnostics?()' in observer
    assert not re.search(r'store\.alertMessage(?!\s*!=\s*nil)', browser)
    executable_browser = re.sub(r'//[^\n]*', '', browser)
    assert not any(token in executable_browser for token in ['localizedDescription', 'store.composer', 'httpBody', 'credential', 'requests[', 'posts['])
    assert 'switch voice.phase' in browser
    assert all(f'phase = "{label}"' in browser for label in ['idle','authorizing','listening','finalizing','transcribing'])
    assert 'dispatch.requests.count' in browser and 'wire.postRequests().count' in browser
    assert 'controllerFixtureFinalizer != nil' in browser

validate_observer(source)
for mutant in [
    source.replace('timeout: TimeInterval = 4', 'timeout: TimeInterval = 20', 1),
    source.replace('timeout <= 20', 'timeout <= 200', 1),
    source.replace('"browser final dispatch", timeout: 20,', '"browser final dispatch", timeout: 4,', 1),
    source.replace('!voice.isActive && dispatch.requests.count == 1 && !store.isRunning }, "browser final dispatch"',
                   '!voice.isActive && dispatch.requests.count >= 1 && !store.isRunning }, "browser final dispatch"', 1),
    source.replace('failure: { store.alertMessage != nil }', 'failure: { false }', 1),
    source.replace('alert_present=\\(store.alertMessage != nil)', 'alert_present=\\(store.alertMessage)', 1),
    source.replace('Voice store fixture error:', 'Voice store controller error:', 1),
    source.replace('alert_present=', 'controller_error=', 1),
]:
    try:
        validate_observer(mutant)
    except (AssertionError, IndexError, ValueError):
        pass
    else:
        raise AssertionError('unsafe composer observer mutant was not rejected')

# Compile the EXACT extracted observer body with a deterministic test-only Date
# binding. Virtual seconds exercise default4 vs browser20 without wall-clock
# sleeps or any App/store/microphone/account/provider. Full App compilation and
# its real isolated composer fixture remain distinct validation gates.
_, observer, _ = observer_parts(source)
header = r'''
import Foundation
@MainActor enum Clock { static var now: Double = 0 }
struct Date: Comparable {
    let seconds: Double
    @MainActor init() { seconds = Clock.now; Clock.now += 1 }
    init(seconds: Double) { self.seconds = seconds }
    func addingTimeInterval(_ n: Double) -> Date { Date(seconds: seconds + n) }
    static func < (a: Date, b: Date) -> Bool { a.seconds < b.seconds }
}
enum RunnerError: Error { case message(String) }
@main struct ComposerObserverFixture {
  @MainActor static func main() async throws {
'''
footer = r'''
    var checks = 0
    Clock.now = 0
    do { try await wait({ Clock.now >= 5 }, "default")
      fatalError("default4 unexpectedly passed5 virtual seconds")
    } catch RunnerError.message(let text) {
      precondition(text == "Voice store deadline: default"); checks += 1
    }
    Clock.now = 0
    try await wait({ Clock.now >= 5 }, "browser", timeout: 20)
    checks += 1
    Clock.now = 0
    do { try await wait({ false }, "never", timeout: 20)
      fatalError("browser observer became unbounded")
    } catch RunnerError.message(let text) {
      precondition(text == "Voice store deadline: never"); checks += 1
    }
    var predicateCalls = 0
    do { try await wait({ predicateCalls += 1; return false }, "failed", timeout: 20,
                       failure: { true }, diagnostics: { " [phase=idle; alert_present=true]" })
      fatalError("fixture alert did not fail early")
    } catch RunnerError.message(let text) {
      precondition(text == "Voice store fixture error: failed [phase=idle; alert_present=true]")
      precondition(predicateCalls == 0); checks += 1
    }
    for invalid in [Double.nan, Double.infinity, 0, -1, 21] {
      do { try await wait({ true }, "invalid", timeout: invalid)
        fatalError("invalid observer budget accepted")
      } catch RunnerError.message(let text) {
        precondition(text == "Voice store observer budget invalid"); checks += 1
      }
    }
    print("Composer observer executable: \(checks) virtual-clock checks PASS; model/mic/network/store/auth0")
  }
}
'''
with tempfile.TemporaryDirectory(prefix='os1-composer-observer-') as directory:
    root = Path(directory)
    fixture = root / 'Observer.swift'
    fixture.write_text(header + observer + footer)
    executable = root / 'Observer'
    subprocess.run(['/usr/bin/swiftc', '-parse-as-library', str(fixture), '-o', str(executable)], check=True,
                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
    result = subprocess.run([str(executable)], check=True, text=True, capture_output=True, timeout=10)
    assert '9 virtual-clock checks PASS' in result.stdout
    print(result.stdout.strip())
print('Composer observer source: default4/browser20/strict predicate/sanitized failure diagnostics PASS; eight unsafe mutants rejected')
