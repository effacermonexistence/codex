# Voice repair — build167

## Scope and failure
Installed Handy selected model `medium`; its actual model filename is
`whisper-medium-q4_1.bin`. OS1 previously looked for `models/medium`, rejected
a valid local model and selected Apple Speech instead. That fallback is not
available for every locale/device configuration.

## Repair
Resolve the selected logical ID through the installed engine's JSON catalog;
verify downloaded status and local file containment. Do not download or switch
models. Run discovery off the UI executor, with an eight-second subprocess
bound and generation/cancellation check before capture begins.

## Verification
Six added catalog cases cover valid ID/filename mapping, unknown ID, absent
file, not-downloaded model, path traversal and malformed JSON. OS1ContextTests
passed. Installed Handy transcribed a synthesized 2.8951875-second fixture as
`Microphone test. Please continue the task.` using medium/MTL0 (2976ms
transcription, 1037ms load). This is an engine check, not proof of live
microphone capture. Runtime adoption is recorded separately below.

## Method
Read https://arxiv.org/abs/2310.01798 (intrinsic self-correction limitations).
Use source diagnosis, executable regression, actual engine output and installed
runtime observation as distinct gates; generated self-explanation is not proof.

## Preservation / rollback
No credentials, conversations, queues or model files are edited. Existing
self-update installer preserves sessions and retains rollback receipts. No
pending external task is deliberately replayed for this test.

## Installed runtime adoption
- Self-update build167 installed, installer 9 checks passed; sessions 98 → 98.
- Receipt: `~/.os1/recovery/self-update-build167-2026-09-19T125412Z/install-receipt.json`.
- Installed app's Voice action entered `Listening / Local Whisper`, with the
  macOS microphone indicator visible. Finish returned transcription to the
  composer. Nothing was submitted as a task.
- Live acoustic test: speech synthesized through MacBook Air Speakers (device
  72), captured by the default MacBook Air microphone. Composer received
  `microphone test please continue the task microphone test please continue the task`.
  The phrase was played twice; this verifies capture → local engine → composer,
  not just standalone file transcription. Test-only draft was cleared afterward.
- Initial acoustic attempt played through the default Apple Vision Pro output;
  its unrelated transcript was rejected as verification evidence and removed.
  Default input/output devices were not changed. Silence transcription accuracy
  is not established by this test.
- Context tests and all staged runtime/Fleet/app/composer/steering/sidebar/queue/
  parallel checks passed. The tested source commit is
  `f89af0c98d88572dbf8c065404b81a3f337231ae`; this receipt changes documentation only.
