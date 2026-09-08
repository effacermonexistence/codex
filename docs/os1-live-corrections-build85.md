# OS1 live correction boundary (build85 design)

## Incident and objective

Conversation E4D096B3-E155-4087-822A-DBC9E1D2A9CB queued the user's
"그 말이 아니라…" correction behind an active Instagram implementation.
The correction later became a standalone read-only objective while the original
implementation continued. Native work also reported a later release than the
pinned source. This task repairs OS1 input/context control, not SCV production.

Convergence: an explicit correction reaches the exact active Codex turn at a
native input boundary; ordinary follow-ups stay FIFO; original objective,
scope, prohibitions, evidence, partial output and correction history survive.
No receipt says delivered before an acknowledgment; no old answer is adopted
as an answer to an undelivered correction. Existing effects are not undone.

## Architecture and invariants

OS1 composer -> immutable per-submission correction request -> existing Codex
app-server single reader/writer -> turn/steer(expectedTurnId) -> acknowledgment
and persisted native user input -> OS1 progress and completion reconciliation.

- No second native writer, new model invocation or cancel/restart masquerading
  as steering. Same model, workspace and permission ticket; no authority change.
- Explicit UI action plus narrowly recognized direct correction prefixes; quoted
  transcripts and ordinary new questions do not silently interrupt a task.
- Separate request and receipt files, UUID-bound to the owner submission,
  bounded size/count, private permissions, atomic persistence. Mark sending
  before transport; unknown delivery is not automatically retried.
- Acknowledgment means native input accepted, not a guarantee that already
  running tools were stopped or that the requested task is complete.
- Accepted amendments must appear in verified native history before current
  result adoption. Any late/missing/ambiguous delivery preserves the correction
  and old output, never silently drops it or restarts writes.
- Unsupported or already-finishing backends retain an explicitly labeled
  correction tied to the original objective; they must not claim live delivery.
- Completed native changes and fresh server identity cannot be overwritten by
  an older pinned snapshot merely because an amendment was queued.

Alternatives rejected: queue everything (observed failure); kill and replay
everything (duplicate writes); call a second app-server reader (response races);
reinterpret arbitrary prose as an interrupt (false positives).

## Verification views

1. Intent: correction targets current task, not a new read-only query.
2. Context: original objective + ordered amendments + exact source preserved.
3. Execution: exact turn ID; one consumer; rejection/EOF/completion races.
4. Output: sent/accepted/unconfirmed distinct; stale completion cannot win.
5. Cost: no extra model turn for successful live steering; no blind retries.
6. Safety/UX: permissions unchanged, no backend window activation, other
   conversations and their queues untouched, persisted restart state.

Run deterministic fixtures first, then installed read-only synthetic steering
and FIFO tests. Do not exercise or deploy the quoted Instagram change. Preserve
the prior signed build and all conversations for rollback; never restore an old
sessions.json over newer messages.

Native protocol reference: https://learn.chatgpt.com/docs/app-server#steer-an-active-turn

## Installed experiment and second boundary

The first installed experiment accepted the correction on the same native turn,
with zero queued follow-ups. The final answer changed from twenty sections to
three Korean sentences. Fresh native readback verified the amendment.
However, the native synchronizer then re-imported the superseded intermediate
answer as external work after the new final. This is another convergence failure.

Repair: bind verified OS1 result receipts to native turn IDs. Advance ingestion
cursors over those owned turns without re-importing their intermediate answers.
Keep originals in the native transcript and event journal; real external turns
with other IDs still synchronize. Recheck ownership when applying an async read
to avoid an ingestion/completion race. Unknown turn IDs are never suppressed.

The installed experiment also exposed a separate permission-negation mismatch
for the phrase “파일 수정이나 명령 실행, 웹 검색은 하지 마.” It was blocked before
model dispatch; adding the previously supported explicit read-only wording
allowed the steering experiment. That router issue is not bypassed by steering.

## Final installed verification

Build 85 / 0.9.34 was rebuilt with the owned-turn ingestion fix and installed
with the existing signing identity. The rollback-capable installer preserved
all 54 existing conversations, messages, pins, drafts and backend bindings.
It passed eight bundled test commands and restarted the existing Fleet agent.

The final synthetic experiment used the actual OS1 composer. While Codex was
streaming a twenty-section answer, the user correction requested three Korean
sentences. One native turn accepted and persisted one amendment, with no queued
follow-up, additional turn, command execution or file change. The final three
sentences matched the latest native answer exactly; the superseded answer was
not re-imported as external work. Twelve evidence checks passed. A separate
installed audit passed 14 groups without model calls or session-store writes.

Deterministic coverage includes 35 transport/mailbox checks, 20 UI steering
checks, 44 queue/fork checks and 28 composer checks. Context regressions passed
123 checks, including owned-turn suppression and continued ingestion of real
external turns. Both arm64 and x86_64 release slices were built. Package scan:
22 files, zero findings. The native UI was inspected for the latest answer,
one receipt, and no duplicated old response.

Scope of this evidence: same-turn Codex corrections and the explicit
unsupported-backend fallback. It does not prove live input support in the
one-shot Claude adapter, undo already executed effects, or claim all routing
and permission classification is optimal. Instagram production was not changed.
