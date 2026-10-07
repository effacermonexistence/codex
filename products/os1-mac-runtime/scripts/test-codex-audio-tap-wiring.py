#!/usr/bin/env python3
"""No microphone/provider access: guard the exact Swift 6 callback boundary."""
from pathlib import Path
import re

def validate(source):
    capture = source.split('private final class CodexAudioCapture:', 1)[1].split('@MainActor', 1)[0]
    assert re.search(r'nonisolated func makeTapCallback\(\) -> @Sendable \(AVAudioPCMBuffer, AVAudioTime\) -> Void', capture)
    assert '{ [self] buffer, _ in append(buffer) }' in capture
    controller = source.split('private final class VoiceDictationController:', 1)[1].split('// MARK: - Native dictation controller fixtures', 1)[0]
    taps = re.findall(r'audioEngine\.inputNode\.installTap[^\n]+', controller)
    assert taps == ['audioEngine.inputNode.installTap(onBus: 0, bufferSize: 2_048, format: format, block: sink.makeTapCallback())'], 'audio tap must use the nonisolated factory, not an actor-inherited inline closure'
    assert 'DispatchQueue(label: "com.omaragi.os1.fixture.audio-tap").async' in source
    assert 'let callback = sink.makeTapCallback()' in source
    assert 'try await invokeVoiceTapFixture(callback, samples: samples)' in source
    assert 'background audio tap lost or reordered synchronous PCM' in source
    assert 'background audio tap send chain failed to drain in order' in source

root = Path(__file__).resolve().parents[1]
source = (root / 'Sources/OS1App/OS1App.swift').read_text()
validate(source)
bad = source.replace('format: format, block: sink.makeTapCallback())',
                     'format: format) { buffer, _ in sink.append(buffer) }', 1)
assert bad != source
try:
    validate(bad)
except AssertionError:
    pass
else:
    raise AssertionError('build335 inline-callback regression was not rejected')
print('Codex audio tap wiring: nonisolated production callback + background fixture PASS; build335 mutant rejected; microphone/auth/network 0')
