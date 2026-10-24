# Composer verification observer (not a production voice change)

The build423 installer failed its isolated `voiceStoreSendSelfTest` at
`Voice store deadline: browser final dispatch`; its raw failure and rollback
receipt remain preserved. The exact browser/controller/store substage was not
recorded and remains unknown. This is the existing4s observer versus unchanged
JS12s/native15s async bounds, not proof that the failed attempt was merely slow
or flaky. Earlier CI421 evidence remains historical, not this failure's cause.

This issue is based on exactc06b008ca977924ff613ea0245e1a9e1997b08a4,
transplanting only the previously reviewed8f2b private fixture observer. Source
code and synthetic/offline verification are distinct from release, install and
actual hard-zero CLI adoption. No version/release pointer is changed here.

This changes only the self-test observer:

- All existing waits default to 4 seconds, unchanged.
- Only `browser final dispatch` receives a bounded 20-second observation budget,
  covering the existing native browser finalizer's 15-second path. JS's existing
  finish/flush/recorder-stop/encoding deadlines and production behavior are not
  changed. The fixed 600ms post-ready synthetic recording interval is unchanged.
- Success remains exactly `!voice.isActive && dispatch.requests.count == 1 &&
  !store.isRunning`. The double-click/latch, exact final text, single POST,
  encoded Blob, fixture-auth and callback-cleanup assertions remain unchanged.
- Only the private browser fixture's actual voice `onFailure` callback sets
  `captureFailureObserved` and fails immediately. Generic/preexisting
  `SessionStore.alertMessage` does not determine failure; it is diagnostic only.
  The diagnostic field is `alert_present`; the error prefix is
  `Voice store fixture error:`. Deadline/error diagnostics contain a closed phase label,
  counts and booleans—not alert text, composer/transcript, audio/request body,
  account or credential values.

`test-voice-send-ui-wiring.py` rejects widened-default, unbounded-budget,
weakened-predicate, missing-error, raw-alert and controller-cause-attribution mutations. It also compiles the
exact extracted observer body with a **test-only virtual Date binding** to
exercise 4 versus 20 virtual seconds and early failure without wall-clock
latency claims. A separately compiled App runs its original isolated synthetic
`--self-test-composer` route; no real microphone/provider/account is needed.

App byte changes require refreshing only the two existing, exact anchored
compiler-token source attestations after the App source is frozen. Public
compiler tokens, anchors, entropy thresholds and scanner behavior remain fixed;
historical unanchored provenance is not rewritten. No release version,
installation, production UI/controller/capture path or Handy change is included.

## Preserved first candidate / conditional failure repair

The first frozen candidate f5e4/d992 failed its one isolated App run after2.5s
with only generic `alert_present=true`, zero POST/dispatch, idle phase. This
does not prove a controller/capture cause: store persistence and other actions
can independently populate alerts, and that run did not record an alert baseline.
Its raw failed log remains preserved. No production failure is inferred.

The follow-up adds a zero-data optional observer ONLY to the existing private
fixture installer callback. The callback still cancels the pending intent and
sets the same store alert. The strict success predicate/all downstream checks
remain unchanged. Closed before-capture/before-send alert booleans and the
fixture-specific failure witness distinguish generic alert presence from that
callback without exposing alert text or audio/request/auth data. Regression
checks keep unrelated/preexisting alerts from rejecting an already/successfully
completed capture; an actual fixture voice failure still fails immediately.

## Closed failure-stage diagnostic candidate (not a capture fix)

The exact2478 GitHub mac job120218231091 failed with
`capture_failure_observed=true`, zero mock POSTs and zero dispatches. Its
before-capture and before-send alert booleans were false. The observer's error
branch fired, not its20s deadline. The same source's local composer fixture
passed; that difference does not establish an OS, timing or recording cause.
Neither the raw log nor the prior observer retained the exact failing stage.

The diagnostic candidate adds an in-memory `VoiceFixtureDiagnostic` only when
`--self-test-composer` begins. It records native lifecycle stages, the closed
`CodexDictationError` enum, and the existing JS capture error vocabulary (any
unknown string/shape becomes `unknown`). Navigation/evaluation/content-process
failures receive closed origin labels. The first failure boundary survives
normal cleanup; later controller catches/cancellation do not rewrite it.

The existing browser fixture's error/deadline output appends those labels and
optional MIME-family/validator booleans. `transcriptionPreflight` denotes entering
the existing transcribe function, not proof that a POST was sent. The two MIME
booleans describe their existing independent shape checks, not valid encoded
audio or a successful request. The exact MIME string is not stored or normalized.
A whitespace-before-semicolon example distinguishes the current validators;
it is a regression discriminator, not a finding about the CI recording.

The candidate does **not** change capture HTML, recorder/audio/microphone
behavior, a deadline, a Send predicate, exception propagation, request encoding,
credentials, retry/fallback, live state or Handy. No raw error/alert, MIME text,
audio, transcript, account, credential or path is admitted to the description.

`test-voice-fixture-diagnostic.py` compiles the actual pure observation value,
error mapper and current MIME/request functions and checks controlled malformed
inputs. Its URLRequest construction does not send a request. The existing
observer/primary-button/browser-wiring gates remain required. An actual isolated
composer run and CI reproduction are separate gates, require the exact compiled
artifact, and are not claimed by these pure/source tests. The diagnostic does
not itself fix or establish the cause of the original failure.

## Build434 observer port / preserved build433 CI failure

This ports only the existing `3c969d1d` observer onto frozen build433 source
`ae7aa4c7b40b6f2e84dc3108ad460b0a2ea42d41`. CI run40072048339's Mac
release step failed at `browser final dispatch` with the same closed witness:
capture-specific failure true, prior alerts false, and mock POST/connection/
dispatch counts zero. The raw failed CI log is retained. The controller,
voice-store fixture, browser adapter, capture HTML and native transcription
source were byte-identical to the build432 comparison source; this does not
establish why one environment failed while another passed.

The failing path is therefore bounded to synthetic browser capture/finalization
before the mocked transcription POST. Its precise recorder/worklet/MIME/
encoding/navigation failure remains unknown. Do not reinterpret this observer
port as a capture fix, increase a clock without a timeout witness, remove the
strict success predicate, retry the CI run blindly, or waive the failed result.
De-instrumenting the two changed existing Swift files must reproduce the exact
frozen parent bytes; the capture HTML/native transcription source stay unchanged.

The separately authorized candidate command is the exact compiled
`<candidate .app>/Contents/MacOS/OS1App --self-test-composer`, not a launch of the
production app. Its entry exits before live SessionStore construction. Voice
fixtures use UUID temporary stores, injected credentials/transport/execution,
and an owned synthetic oscillator instead of microphone access. The broader
composer fixture also creates and removes two fresh UUID cancellation markers
under `Library/Application Support/OS-1/run-journals`; consequently the entire
command must not be called literally temp-only. This port's pure tests do not
launch that App command. Candidate runtime/CI qualification remains a separate
gate owned by the release operator after checking ongoing work.
