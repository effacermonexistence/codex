#!/usr/bin/env python3
"""Production capture/Blob/Send contract; no microphone, credentials or provider."""
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
app = (root/'Sources/OS1App/OS1App.swift').read_text()
html = (root/'Resources/CodexDictationCapture.html').read_text()
adapter = (root/'Sources/OS1App/CodexBrowserMicrophone.swift').read_text()
release = (root/'scripts/build-release.sh').read_text()
installer = (root/'scripts/install-os1.sh').read_text()

def validate_app(source):
    controller = source.split('private final class VoiceDictationController:',1)[1].split('// MARK: - Native dictation controller fixtures',1)[0]
    assert 'try await browser.start' in controller
    assert 'let recording = try await browser.finish()' in controller
    assert 'transcribe(audio: recording.data,' in controller and 'contentType: recording.contentType' in controller
    assert 'browserCaptureEnabled = browserMicrophone != nil || fixtureFlags.isDisjoint' in controller
    assert 'nativeStreamingFeatureState' in controller and 'native batch branch used' in controller
    assert 'CodexMicrophoneDocumentView(webView: webView)' in source
    assert 'store.installBrowserStoreFixture()' in source
    assert 'browser batch forced streaming or repeated provider request' in source

validate_app(app)
assert 'getUserMedia' in html and 'channelCount: 1' in html
assert 'getSupportedConstraints' in html and 'getSettings' in html
assert 'new MediaRecorder(' in html and '2048' in html
assert 'connect-src \'none\'' in html
assert not any(word in html for word in ['Authorization', 'Bearer ', 'api_key', 'chatgpt.com/backend-api'])
assert '.nonPersistent()' in adapter and 'type == .microphone' in adapter
assert 'AVCaptureDevice.authorizationStatus(for: .audio) == .authorized' in adapter
assert 'message.webView === webView' in adapter and 'body["nonce"] as? String == nonce' in adapter
assert 'CodexDictationCapture.html' in release and release.count('Contents/Resources/CodexDictationCapture.html') == 2
assert 'requires_browser_capture=1' in installer
assert 'release_patch >= 274' in installer
assert 'expected_payload_files=23' in installer and 'expected_component_files=26' in installer
assert 'requires the browser capture document' in installer
assert '"Applications/OS-1 CLODEX.app/Contents/Resources/CodexDictationCapture.html"|\\' in installer
mutant = app.replace('transcribe(audio: recording.data,', 'transcribe(wav: Data(),',1)
try:
    validate_app(mutant)
except AssertionError:
    pass
else:
    raise AssertionError('raw-PCM substitution regression not detected')
print('Browser dictation wiring: owned browser mono/DSP + encoded whole Blob + one actual-store Send PASS; raw-PCM substitution mutant rejected; microphone/account/provider 0')
