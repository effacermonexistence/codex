# Build 96: usable steering and explicit task replacement

## Observed incident and scope

On build95, conversation 2199FBE3-691C-4B12-B506-34FCCA8C9520 retained a
QMGR retrieval request behind an effects_uncertain failure from an Instagram
preparation. Its bounded read-only reconciliation had already ended. Persisted
state: zero in-flight runs, one queued request, old lastFailure still present.
The disabled queue button could only call native Codex turn/steer, while the
scheduler excluded every request after the failure. The anchored correction
parser also missed "아 그거 하지 말고". Screenshot alone was not the diagnosis.

Scope: native OS1 steering/queue behavior, compact UI, regression tests and
installed verification. No Instagram production writes, permission expansion,
model-ranking changes, native security bypass or replay of previous changes.

## Five perspectives / acceptance

- Intent: amendment, ordinary queued follow-up and explicit task replacement
  are distinct. Replacement must not preserve the abandoned objective as an
  instruction. User input appears once, with its original ID/text.
- Context: retain conversation/history and failed-task evidence; on explicit
  replacement invalidate the old task's bound source/project/backend context.
  Preserve unresolved-effect warnings, never mark the abandoned task complete.
- Execution: same-turn Codex input requires a live matching lease and native ACK.
  A replacement or an explicit action on an unavailable backend is an OS1-owned
  stop/continue transition: old run must leave admission before a new one starts.
- Verification/UX: display the actual action (steer vs start next), avoid a dead
  disabled "send now" after the turn ends. Acknowledgement is not completion.
- Cost/latency: deterministic state tests first, no extra model to classify a
  button click. No polling-triggered new turns or duplicate side effects.
- Security: do not steer mutation into read-only recovery, bypass permissions,
  forge tool acceptance, or automatically replay uncertain writes. Explicit
  replacement preserves a durable record and carries unresolved-effect warning.

## Architecture and invariants

Composer / queue -> amendment: existing lease -> turn/steer -> ACK + persisted
input. Ordinary Enter stays FIFO. Explicit replacement / queue action when no
steerable turn: durable replacement intent -> request cancellation if running
-> observe old run termination -> preserve old task record -> fresh objective
and normal preflight/routing. Never start a second run in the same conversation
before the first has terminated. Editing and restart holds remain respected.

Use a persisted replacement intent on PendingSubmission and a preserved-task
record in ConversationSession. Do not erase the old failed task to "unstick"
the queue. Unrelated queued entries remain ordered and are not auto-promoted
into corrections. Duplicate clicks and cross-session actions cannot duplicate
delivery. A queue action is explicit authorization to prioritize that input,
not authority to expand its permissions.

Alternative rejected: enable turn/steer during recovery or merely remove all
failure checks. Both conceal the real lifecycle boundary and can repeat writes.

## Protocol reference and verification

Official OpenAI Docs: https://learn.chatgpt.com/docs/app-server , active-turn
steering requires expectedTurnId and does not create a new turn; no active turn
means failure. Use that boundary rather than additional chain-of-thought prompts.
The OpenAI Docs skill informed the distinction between native same-turn steering
and OS1-controlled stop/continue; these must not be presented as the same ACK.

Tests: same-turn ACK/reject, queued warmup amendment, exact Korean replacement,
terminal blocked queue, recovery in flight, Claude/no native lease, duplicate
click, edit hold, restart hold, cross-session isolation, context provenance and
permission boundaries. Validate functionality before compact UI geometry,
keyboard/accessibility and installed screenshot. Rollback only app/CLI binaries;
preserve newer conversations and optional state fields. No global 100% claim.
