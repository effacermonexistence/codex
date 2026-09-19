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
