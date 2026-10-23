# Current native control: optional pre-turn settings snapshot

Scope: persistence grammar compatibility only, not answer quality, quota proof,
new dispatch authority, or a replacement for the owner collection verifier.

The exact current `0.163.0-alpha.11.1` persistence format can write one
`event_msg/thread_settings_applied` immediately after `session_meta`, before
`task_started`. The same turn still writes its own settings after `turn_context`.
Previously, the pre-turn metadata failed the active-turn guard.

The adapter admits at most that one row-1 snapshot. Its envelope/payload keys,
thread, model, effort and provider must match the known format and current
binding. It does **not** increment or replace the required in-turn settings
counter. An optional outer ordinal must be the exact non-boolean integer row
index; an optional timestamp must be a string. No extra user, unknown record,
action/tool, wrong tuple, future CLI
version or malformed/duplicate snapshot becomes complete through this branch.
Legacy parsing and the existing in-turn/input/final checks are unchanged.

`NativeTurnControl9394Fixture` adds 47 bounded assertions, including the count
invariant, while keeping the existing 52-current/26-legacy fixture stdout
protocol unchanged. The additional assertions throw on failure; no production
output normalization or assertion weakening is used.

Private, pure source-parser verification preserved the previous source's
`binding` rejection on both explicitly named retained build-428 rollouts, then
verified the new public `inspect` on the same immutable bytes. Each contains
17 rows and matching native-input/final hashes; the parser accepted both with
16 observed non-session rows and zero recorded tool requests. Reports contain
only typed control observations and hashes, not private reasoning or answers.
This does not itself validate the outer receipt/witness custody, recover a
held Core task, promote quality evidence, or prove a release installation.

The focused diagnostic linked immutable completed-build-427 Context/System
dependencies for the digest/support types, with the exact new parser source
body compiled in a separate module. It is not the installed build-428 Context
binary. No SDK/provider/model call or live state/receipt write occurred.
