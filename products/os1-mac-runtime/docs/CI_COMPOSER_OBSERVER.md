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
- Fixture alert presence (`alertMessage != nil`) fails immediately. It is not
  attributed to a controller cause: other SessionStore paths can set alerts.
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
