# Build 93: steering and native-input provenance

## Objective and evidence

OS1 remains the user interface. An explicit queued request can be delivered to
the current capable Codex turn without restarting it. OS1-created recovery
instructions must never become an apparent user statement or future user context.
Production Instagram changes, permission expansion, model retraining and routing
policy redesign are not part of this repair.

The September 8 incident contains three native Codex turns. Only the last adopted
turn was registered as OS1-owned. All three have private, hash-checked outbox
records. The native importer subsequently added eight rows from the first two
turns, including a recovery instruction as a right-aligned user message. The queue
offered edit/reorder/delete but no direct queued-input steering control.

The initiating request also missed preparation recognition: “세팅 ... 수정
봐야되니까” was routed as a concrete edit instead of acquiring current project
materials. Add these bounded preparation/future-intent forms with concrete-edit
negative controls; do not modify Instagram production to test recognition.

## Five perspectives and acceptance gates

| View | Observed divergence | Required convergence |
| --- | --- | --- |
| Intent/completion | Queued correction inaccessible | Explicit queue-to-current-turn action; ordinary Enter remains FIFO |
| Provenance/context | Internal readback labeled user | Zero managed imports in user transcript or handoff; genuine external messages preserved |
| Execution | Ownership recorded only after adoption | Durable ownership at turn/start response, including rejected/retried attempts |
| Output/verification | Duplicate commentary after final | Managed native rows archived in-place, not rendered as fresh external work; ACK is not task completion |
| Cost/latency | UI issue causes extra turns | No model call for provenance repair; steering uses the existing turn |
| Safety/UX | Correction could reach recovery or another task | Same session, live lease, unchanged scope; recovery remains read-only and does not accept work redirection |

## Minimal architecture

User input -> FIFO queue OR explicit steer -> live thread/turn ACK -> existing
OS1 result custody. Runtime records a private thread/turn/submission ownership
receipt immediately after starting each turn, independent of result adoption.
Native import unions that ledger with verified legacy outbox evidence. Managed
rows stay in native logs; previously imported rows retain their original bytes,
IDs and timestamps with an additional provenance marker. Visible transcript,
copy/export and provider handoff use the same filtered projection.

Do not use text-prefix suppression: a user can legitimately quote the same
instruction. Do not hide an entire native session: external turns remain valid.
Do not restart a write to simulate steering or weaken a permission boundary.

## Research/protocol rationale

- Codex app-server `turn/steer` requires expectedTurnId and does not create a turn:
  https://learn.chatgpt.com/docs/app-server . Test ACK, rejection and race-to-completion.
- Instruction Hierarchy, https://arxiv.org/abs/2404.13208 : instruction sources
  require distinct authority. Here this means explicit local provenance, not
  implementing the paper's training algorithm.
- Continual Learning of Instruction Following from Realtime Feedback,
  https://arxiv.org/abs/2212.09710 : realtime feedback motivates testing correction
  delivery during execution. No contextual-bandit training or claimed accuracy
  uplift is introduced by this UI/protocol patch.

## Verification and rollback

Reproduce the exact three-turn/eight-row incident with stored IDs and verified
outbox evidence. Test external lookalikes, cross-session ownership, interrupted
turns, queue editing, unavailable/readback turns, double submission, Unicode NFD,
ACK/rejection, restart and copy/context projection. Run cheap fixtures before
bounded live protocol verification. Build and install with the existing stable
signing identity only while idle; preserve all sessions, pins, drafts and native
logs. Keep prior binaries and pre-install state privately; rollback binaries
without overwriting any newer user conversation. Report measured outcomes, not
global optimality or universal task success.
