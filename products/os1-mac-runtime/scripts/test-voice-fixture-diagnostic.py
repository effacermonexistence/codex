#!/usr/bin/env python3
"""Closed fixture diagnostics + actual MIME predicates; no App/mic/network/provider."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / 'Sources/OS1App/VoiceFixtureDiagnostic.swift'
ADAPTER = ROOT / 'Sources/OS1App/CodexBrowserMicrophone.swift'
APP = ROOT / 'Sources/OS1App/OS1App.swift'
NATIVE = ROOT / 'Sources/OS1Context/CodexNativeDictation.swift'
HTML = ROOT / 'Resources/CodexDictationCapture.html'
h, adapter, app, native, html = [p.read_text() for p in [HELPER, ADAPTER, APP, NATIVE, HTML]]

# Inputs from JavaScript are mapped into the current closed source vocabulary.
known = set(re.findall(r'"([a-z_]+)"', html.split('const knownErrors = new Set([', 1)[1].split(']);', 1)[0]))
jsenum = h.split('enum JavaScriptError: String {', 1)[1].split('    }', 1)[0]
observed = set(re.findall(r'\b[a-z][a-z_]+\b', jsenum)) - {'case'}
assert observed == known | {'unknown'}, 'diagnostic JS vocabulary must match current capture source'
assert all(x not in h for x in ['FileManager', 'Process(', 'URLSession', 'UserDefaults', 'print(', 'localizedDescription'])
assert 'fixtureDiagnostic = CommandLine.arguments.contains("--self-test-composer") ? VoiceFixtureDiagnostic() : nil' in adapter
observation_api = adapter.split('// Data-only, closed fixture observations.', 1)[1].split('    private static func fixtureError(', 1)[0]
assert observation_api.count('guard CommandLine.arguments.contains("--self-test-composer") else') == 3
assert 'if phase != .idle { fixtureDiagnostic?.failed(' in adapter
assert 'fixtureDiagnostic?.javaScriptFailed(payload["code"])' in adapter
assert 'fixtureDiagnostic?.observedMIME(contentType)' in adapter
assert 'fixtureOrigin: .evaluation' in adapter and 'fixtureOrigin: .contentProcess' in adapter
assert adapter.count('fixtureOrigin: .navigation') == 2
controller = app.split('private final class VoiceDictationController:', 1)[1].split('// MARK: - Native dictation controller fixtures', 1)[0]
assert 'browser.observeControllerFixtureFailure(error as? CodexDictationError ?? .transportFailed)' in controller
assert controller.count('browser.observeFixture(') == 6
browserfixture = app.split('// Real owned-browser MediaRecorder', 1)[1].split('    _ = renderedHosts.count', 1)[0]
assert 'browser.fixtureDiagnosticDescription' in browserfixture
assert 'try await wait({ !voice.isActive && dispatch.requests.count == 1 && !store.isRunning }, "browser final dispatch", timeout: 20,' in browserfixture
assert 'failure: { captureFailureObserved }' in browserfixture
diagnostic_body = browserfixture.split('diagnostics: {', 1)[1].split('        let posts = await wire.postRequests(), connections', 1)[0]
assert all(x not in diagnostic_body for x in ['localizedDescription', 'alertMessage)', 'httpBody', 'base64'])

# Compile the actual source functions, not a guessed replacement predicate.
errorenum = native.split('public enum CodexDictationError:', 1)[1].split('public struct CodexDictationHTTPResponse:', 1)[0]
errorenum = 'public enum CodexDictationError:' + errorenum
browservalidator = adapter.split('    private static func validContentType(', 1)[1].split('    private static func isOwnURL(', 1)[0]
browservalidator = '    static func validContentType(' + browservalidator
mapper = adapter.split('    private static func fixtureError(', 1)[1].split('    private func validatedMetadata(', 1)[0]
mapper = '    static func fixtureError(' + mapper
# Mapper follows the observation functions and precedes validatedMetadata.
assert mapper.count('static func fixtureError(') == 1 and mapper.count('switch error {') == 1
ntoken = native.split('    private static func token(', 1)[1].split('    public static func normalizedLanguage(', 1)[0]
ntoken = '    private static func token(' + ntoken
language = native.split('    public static func normalizedLanguage(', 1)[1].split('    public static func transcriptionRequest(wav:', 1)[0]
language = '    public static func normalizedLanguage(' + language
request = native.split('    public static func transcriptionRequest(audio:', 1)[1].split('    public static func streamingRequest(', 1)[0]
request = '    public static func transcriptionRequest(audio:' + request

swift = 'import Foundation\n' + errorenum + '\n' + h + '\nenum ActualBrowser {\n' + browservalidator + mapper + '}\n'
swift += 'enum ActualRequest {\n static let transcriptionURL = URL(string: "https://fixture.invalid/transcribe")!\n' + ntoken + language + request + '}\n'
swift += r'''
@main struct DiagnosticFixture {
 static func main() throws {
  var checks = 0
  func check(_ yes: Bool) { precondition(yes, "closed diagnostic fixture failed"); checks += 1 }
  var d = VoiceFixtureDiagnostic()
  check(d.failureOrigin == nil && d.browserMIMEShapeValid == nil && d.requestMIMEShapeValid == nil)
  check(d.closedDescription.contains("fixture_js_error=unknown"))
  d.reached(.ready); d.reached(.finishRequested)
  d.javaScriptFailed("worklet_flush_timeout")
  d.failed(origin: .nativeAdapter, error: .timedOut)
  d.reached(.finalizationReady); d.failed(origin: .controller, error: .transportFailed)
  check(d.failureOrigin == .javascript && d.failureStage == .finishRequested && d.stage == .finishRequested)
  check(d.javaScriptError == .worklet_flush_timeout && d.nativeError == .timedOut)
  let privateText = "PRIVATE_SENTINEL-do-not-log-audio-token-text-path"
  for value in [privateText, 1, false, ["code": privateText], [privateText]] as [Any] {
   var s = VoiceFixtureDiagnostic(); s.javaScriptFailed(value)
   check(s.javaScriptError == .unknown && !s.closedDescription.contains(privateText))
  }
  var reset = VoiceFixtureDiagnostic(); reset.reached(.ready)
  check(reset.failureOrigin == nil && reset.stage == .ready)
  let errors: [CodexDictationError] = [.credentialUnavailable, .invalidCredential, .invalidAudio,
   .invalidRequest, .invalidState, .cancelled, .timedOut, .transportFailed, .serverRejected,
   .invalidResponse, .messageTooLarge, .emptyTranscript]
  let labels = ["credentialUnavailable", "invalidCredential", "invalidAudio", "invalidRequest", "invalidState",
   "cancelled", "timedOut", "transportFailed", "serverRejected", "invalidResponse", "messageTooLarge", "emptyTranscript"]
  for (e, label) in zip(errors, labels) { check(ActualBrowser.fixtureError(e).rawValue == label) }
  let bases = ["audio/webm", "audio/ogg", "audio/mp4", "audio/wav", "audio/aac", "audio/x-m4a", "text/plain", "", privateText]
  let suffixes = ["", ";codecs=opus", " ;codecs=opus", "; codecs=mp4a.40.2", ";", "\n", "\u{0000}"]
  for base in bases { for suffix in suffixes { for prefix in ["", " "] {
   let mime = prefix + base + suffix
   var s = VoiceFixtureDiagnostic(); s.observedMIME(mime)
   check(s.browserMIMEShapeValid == ActualBrowser.validContentType(mime))
   let valid = (try? ActualRequest.transcriptionRequest(audio: Data([1]), contentType: mime,
                bearerToken: "fixture-only", boundary: "fixture-only")) != nil
   check(s.requestMIMEShapeValid == valid)
   check(!s.closedDescription.contains(privateText))
  } } }
  for mime in [String(repeating: "x", count: 129), "audio/mp4;" + String(repeating: "x", count: 121), "audio/mp4;💥"] {
   var s = VoiceFixtureDiagnostic(); s.observedMIME(mime)
   check(s.browserMIMEShapeValid == ActualBrowser.validContentType(mime))
   check(s.requestMIMEShapeValid == ((try? ActualRequest.transcriptionRequest(audio: Data([1]), contentType: mime,
               bearerToken: "fixture-only", boundary: "fixture-only")) != nil))
  }
  var mismatch = VoiceFixtureDiagnostic(); mismatch.observedMIME("audio/mp4 ;codecs=mp4a.40.2")
  check(mismatch.browserMIMEShapeValid == true && mismatch.requestMIMEShapeValid == false)
  check(mismatch.mimeFamily == .mp4) // Observe mismatch; never rewrite actual MIME.
  print("VOICE_FIXTURE_DIAGNOSTIC_PASS checks=\(checks) app_launches=0 microphone=0 provider=0")
 }
}
'''
known_swift = '[' + ','.join(json.dumps(x) for x in sorted(known)) + ']'
swift = swift.replace('  let privateText =', '  for code in ' + known_swift + ' {\n   var s = VoiceFixtureDiagnostic(); s.javaScriptFailed(code)\n   check(s.javaScriptError?.rawValue == code && s.failureOrigin == .javascript)\n  }\n  let privateText =', 1)
with tempfile.TemporaryDirectory(prefix='os1-voice-diagnostic-pure-') as temporary:
    t = Path(temporary); s = t/'Fixture.swift'; exe = t/'fixture'
    s.write_text(swift)
    subprocess.run(['swiftc', '-parse-as-library', str(s), '-o', str(exe)], check=True, capture_output=True, text=True, timeout=60)
    result = subprocess.run([str(exe)], check=True, text=True, capture_output=True, timeout=10)
    print(result.stdout.strip())
print(json.dumps({'status':'DIAGNOSTIC_NOT_FIX','source_sha256':{str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in [HELPER,ADAPTER,APP,NATIVE,HTML]},'actual_app_executed':False,'microphone_calls':0,'provider_calls':0,'source_predicate_checks':True},sort_keys=True))
