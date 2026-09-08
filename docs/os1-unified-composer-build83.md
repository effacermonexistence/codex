# OS1 unified composer — build 83

## Before-code design

The owner additionally requests the existing visual design with one coherent
send/follow-up/stop control. Build82 has two adjacent controls; the independent
review found a double-click hazard when a unified Send immediately becomes Stop.

Use one 44px primary control in the existing position. Derive its action from
selected-conversation state: empty idle = disabled send; draft idle = send;
empty running = stop; draft running = queue. While stopping, empty is disabled
and drafts can still be queued; cancellation never clears a draft or queue.
Voice authorization/finalization is disabled until the existing dictation
controller completes. Active recording finalizes into the existing send path.

Enter remains submission-only, not a primary-button invocation: empty Return
never stops a task. The explicit File/context-menu Stop stays available with a
draft. A primary submit records a conversation-local activation timestamp; a
following Stop within the system double-click interval is ignored. The explicit
Stop menu is not delayed. Repeated stop requests are idempotent until ack.

Five perspectives: intent = no redesign or live-steer claim; context = preserve
build82 FIFO/fork and per-chat drafts; execution = exact submission cancellation,
not global kill; verification = state/action/label plus real manager regressions;
cost = deterministic fixtures and no extra backend calls for button tests.
Security/UX: preserve unknown-write/source holds and active user tasks.

## Acceptance

- State fixtures: idle-empty/draft, running-empty/draft, stopping-empty/draft,
  dictation authorizing/finalizing/transcribing/listening.
- Send followed by a fast second click must not cancel the new run.
- Empty Return never stops; queued text retains same-session FIFO/context.
- Stop acknowledges once, does not affect other conversations, draft or queue.
- Existing queue/fork/parallel/sidebar suites and installation custody pass.
- Single-control native rendering and installed accessibility actions match.

## Boundaries

FIFO is the default and is called queue, not live steering. Current Codex/Claude
adapters do not implement an acknowledged shared live-steer protocol. No
cancel/restart substitute is introduced. This is not full parity with every
Codex cloud/plugin/service capability.

The build82 real-UI echo fixture produced a valid native answer but a server
retry ticket, so its dependent queue correctly held. That signed result is
preserved as an independent routing/verification finding, never force-adopted.
Normal conversation queue flow must be verified separately from this hold case.

Rollback: preserve signed build82 app/CLI and current sessions; upgrade only idle.
Never restore historical sessions.json over newer conversations.

References: https://learn.chatgpt.com/docs/reference/settings and
https://learn.chatgpt.com/docs/app-server distinguish wait, steer and interrupt.
