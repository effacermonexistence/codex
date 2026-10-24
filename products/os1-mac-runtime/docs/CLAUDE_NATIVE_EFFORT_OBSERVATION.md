# Source-bound Claude effort observation

Claude's provider-native assistant envelope may contain root-level `effort`
and `perTurnEffort`. An exact current-attempt assistant witness can expose
those metadata without treating the selected configuration or its ACK as
observed execution.

The existing gates remain mandatory: owned stable bounded native file,
same session, timestamp within the immutable attempt interval, exactly one
assistant whose nonempty visible text hashes to the final execution receipt output,
and the final native receipt/configuration bindings in the projection.

Only `low`, `medium`, `high`, and `max` are supported by this bounded reader.
Either root field may supply the observation. If both exist, they must be
valid strings and identical. Missing, malformed, conflicting, or unsupported
metadata leaves effort unknown while retaining an otherwise valid observed
model. No field is borrowed from another assistant, an old/foreign session,
thinking-only rows, nested message/content values, requested settings, or ACK.

The legacy `native_assistant_model` basis name remains wire-compatible; the
same source/output hash bindings now also cover optional effort metadata.
This is an observation of native message metadata, not proof of internal
reasoning tokens, compute allocation, task quality, or flagship parity.
No reasoning/answer body enters the public task graph.

The existing fixture retains all 59 checks and adds 45 source-bound effort
checks (104 total): supported single/dual fields, malformed/unsupported values,
conflicts, old/foreign/different-output rows, thinking-only metadata, nested
content, empty-output hash collisions, and unchanged source/output hash attribution. These are deterministic
temporary fixtures, not a new provider call or installed UI qualification.
