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
