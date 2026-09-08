# OS1 queue and conversation controls — build 82

## Objective and scope

OS1 owns the interaction: Enter during a run queues a follow-up without cancelling,
steering or duplicating the active turn. Successful completion admits the next
turn with the newly adopted context. Independent conversations may run concurrently.
Users can inspect, edit, reorder, pause/resume and remove waiting inputs, and fork
completed conversation history without opening either backend.

This is an interaction-layer change, not a new routing model, production SCV edit,
permission grant, remote deployment, or claim that every Codex feature is cloned.
Existing pin/order, archive/unarchive, rename, history search, copy/export, drafts,
Enter/Shift+Enter, stop, progress and backend inspection are regression scope.

## Before-code evidence / five perspectives

1. Intent: installed build 81 already queues within a busy conversation. The live
   incident has one active request and one waiting follow-up, not a second dispatch.
2. Context: admission builds the handoff after the previous result. Queue editing
   currently removes the item into the composer, losing queue position/identity on
   resubmit. A fork must not share native writer IDs or copy an unfinished answer.
3. Execution: scheduler has per-conversation exclusion and a four-session limit.
   Error pause IDs can outlive a successful recovery; removing/reordering a paused
   head does not wake other eligible work. Generic errors do not consistently block
   dependent turns. Existing live work must not be interrupted for installation.
4. Output: a one-line waiting row has no reason, position or distinction between
   ordinary FIFO waiting and a stopped queue; global resume affects other chats.
5. Cost/latency: queue operations and fork creation require zero model calls.
   Test real manager scheduling with deterministic delayed child/runner fixtures;
   no speculative paid retries or production/customer changes.
6. Safety/UX: stop never implies rollback, failure never implies success, restart
   never silently repeats uncertain changes. Preserve every existing message,
   draft, queue payload and signing identity. Do not foreground backend apps.

## Design / state transitions

Composer -> persisted waiting input -> admission (one writer per conversation)
-> execution -> adopted result/context -> next eligible waiting input.

Waiting reasons are derived explicitly: current run, manual pause, restart pause,
editing, previous failure/source pending, or global capacity. Only a user resume
clears manual/restart pause; only actual recovery clears a dependency failure.
Pause does not cancel a running task. Queue edits retain ID, position, workspace,
capacity and draft. An edit lease blocks the edited input and its successors.

Fork -> new OS1 conversation ID, copied completed messages/source/project/decisions,
new objective identity, no native bindings, no active/queued work, no auto-submit.
During a run use its pre-admission completed snapshot. A failed legacy session with
no reliable completed checkpoint is not silently called a completed-history fork.
Workspace files are shared; conversation fork is explicitly not a Git worktree.

Rejected alternatives: turn cancellation/relaunch on every Enter (duplicates and
token waste); global queue bypass (breaks context); copying native IDs into fork
(two writers); making failures look successful to drain the queue.

## Acceptance / convergence

- Three rapid inputs dispatch once each, FIFO, one active writer, latest context.
- Queue editing does not remove/reidentify/reorder the input or overwrite a draft.
- Up/down ordering remains inside one conversation; cancelled inputs never execute.
- Pause/resume is conversation-local; restart and failures have visible reasons.
- Successful explicit recovery unblocks dependents; uncertain writes stay blocked.
- Independent conversations overlap, maximum four; background results do not steal focus.
- Fork preserves completed history and source, excludes live/queued work, creates
  independent backend bindings on the first new request, and preserves parent state.
- Existing interaction regressions, installed native UI and signing/data preservation pass.

Observed mismatches are divergence; individual passing checks do not compensate
for an unverified hard gate. Record actual results after execution.

## Reference and limits

[Official Codex App Server documentation](https://learn.chatgpt.com/docs/app-server)
distinguishes start, steer, interrupt, completion and history fork. OS1's requested
default is queue, not steer. The common OS1 fork preserves context across either
backend rather than copying a backend's active session. This is deterministic
scheduling/state management, not a CoT or trained research algorithm.

## Rollback

Build and verify in staging. Upgrade only with no live OS1/Fleet run; preserve old
signed app/CLI and a private session evidence snapshot. Never restore an old
sessions.json over newer user work. Optional Codable fields keep old stores readable.

## Interaction inventory

| Feature | Implementation / verification boundary |
| --- | --- |
| Follow-up queue | One active turn per conversation; Enter queues, Shift+Enter is a newline |
| Queue management | In-place edit, remove, up/down, drag order, next position, local pause/resume |
| Queue visibility | Count, position, wait reason, running animation; bounded scrolling list |
| Fork | Completed OS1 history/context into an independent conversation; no automatic submission |
| Parallel tasks | Existing four-conversation scheduler retained; each has independent context/progress |
| History | Existing pin/order, archive/unarchive, rename, body search, complete copy/export retained |
| Composer | Existing persistent per-conversation drafts, IME handling and voice controls retained |
| Backend | Existing explicit inspector/reveal and background completion retained |
| Deliberately distinct | Fork shares workspace files; it does not create a Git worktree. Queue is not live steering. |

The reference application also has cloud work, plugins and services outside this
local interaction repair. Neither this inventory nor a passing regression suite
claims full parity with every external product/service.
