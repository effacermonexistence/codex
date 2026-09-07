# OS1 product acceptance on the installed Pro build

## Objective and boundary

Finish the user's named OS1 product requirements on this Mac: one usable OS1
surface, background Codex/Claude execution, completion-first model/effort
routing, real source retrieval and context continuity, readable selectable
output, concurrent sessions, recoverable execution and preserved user state.
The baseline is the installed 0.9.21/build70, not an old build68 report.

This is separate from the already documented Air native-runtime installation
blocker. Do not change Air, Fleet topology, SCV/Instagram production, billing,
credentials, public release channels or Apple policy for this local audit.
Do not claim every future task or a globally optimal unseen model choice from
a finite suite. A failed hard criterion remains failed regardless of savings.

## Architecture and minimal intervention

User objective + workspace + verified source -> capability/permission preflight
-> RCC eligibility and completion evidence -> signed model/effort ticket ->
background executor -> incremental public progress -> independent adoption ->
durable result -> same native transcript and OS1 conversation.

Keep source bytes, native session identity, signatures and user intent intact.
Run deterministic and recorded-incident tests first. Only repair a reproduced
boundary, add a paired negative control, repeat on the installed artifact, and
preserve the pre-change signed app/CLI for rollback without rolling back user
conversation data. Do not generate another answer when result replay suffices.

Rejected alternatives: forcing one expensive model, bypassing result validation,
concealing failed attempts, forcing OS1 always on top, editing old answers to
make a test pass, or repeating dozens of model calls to manufacture optimality.

## Acceptance matrix (at least five independent perspectives)

| Perspective | Required evidence on current build |
| --- | --- |
| Intent/completion | Arithmetic uses OS1; ordinary explanation completes; actual authorized command executes; tool/capability failure cannot become a false success. |
| Source/context | Actual R2 OPT + QMGR material with exact hashes; spelling variants converge on the same source; follow-up preserves it; protected routing source stays out of provider prompts. |
| Execution/capability | Available model/effort catalog covered; explicit provider pins, permission limits and exhausted capacity respected; retry/alternate backend is bounded and carries the original objective. |
| Output/verification | Native answers and transcript agree; prose/math/tables readable; copy spans questions, answers and receipts; adoption is distinct from source/transport verification. |
| Tokens/latency | All failed and successful attempts counted; unknown usage not zero; completion precedes cost, then measured latency; no extra call for replay. |
| UX | Enter sends, Shift-Enter newlines, IME composition protected, queue/parallel/pin/archive/rename/search/drafts work, per-session activity changes; no automatic foreground stealing, explicit backend inspector uses exact ID. |
| Security/recovery | Existing sessions unchanged; signing identity and private-core exclusion verified; narrow TCC behavior preserved; duplicate delivery cannot regenerate or double-execute work. |
| Voice | Explicit start/stop/cancel, late callback rejection, segment continuity and existing composer preservation; local transcription path checked independently where the installed engine is available. |

Native render and event-delegate tests are not physical mouse/audio observations.
Report their exact coverage. Live probes use isolated test state/workspaces and
bounded one-shot markers; preserve failed outputs and usage for any repair.

## Sources applied

- OpenAI model selection: https://developers.openai.com/api/docs/guides/model-selection
  — quality acceptance first, then measured cost/latency; no static blanket tier rule.
- Codex App Server: https://developers.openai.com/codex/app-server/
  — discover executable model/effort capabilities instead of assuming a fixed catalog.
- Existing evidence-first workflow: separate source, execution, adoption and
  empirical observations, rather than adding generic reasoning prompts.

Private current-run evidence: `/tmp/os1-product-acceptance.5KK5Gv/`.

## Reproduced boundary: backup location is not content identity

Fresh installed-build retrieval fails after successful R2 connection. The live
OPT manifest and pinned QMGR v1 manifest have the SAME commit and SHA-256 but
different backup run keys (`34024876452-1.bundle` vs `33306718043-1.bundle`).
The guard incorrectly requires the latest backup location to equal the immutable
supplement's original location. Scheduled backups can therefore break retrieval
without any source change.

Repair: validate repository/commit/object path/digest before acquisition; reuse a
verified content-addressed bundle when commit and digest match regardless of run
key. If latest content advances, independently verify the supplement's pinned
base bundle, never relabel it as latest. Preserve both the manifest reference and
actual verified readback key in evidence. Verify the bundle's main ref equals the
claimed commit, not merely that the commit exists somewhere in its history.
Do not alter R2 originals, pinned evidence hashes, or scientific claim limits.

Tests: same bytes/new run key succeeds; changed commit or digest requires separate
verification; wrong repository/path/commit/hash/size fails; installed live R2
retrieval and downstream source continuity succeed. Rollback retains build70
and conversation data separately.

## Voice lifecycle boundary

The local transcription helper waits for process exit before draining stdout and
stderr pipes. A child that fills either pipe cannot exit; the helper has neither a
deadline nor child cancellation. Task.detached does not inherit parent task
cancellation. Reproduce this exact ordering with a bounded child-output fixture.
Replace only this helper with private file-backed bounded output and a shared
cancellation signal, terminate/reap its exact child on cancel/deadline, and keep
the existing transcript decoder and composer behavior. Bind permission replies
to the recording generation so a stale authorization cannot start a later session.
Tests cover large output, deadline, cancel-before-start, cancel-while-running,
nonzero exit, and output limit. No microphone permission or model download is
required for these lifecycle tests.

## Fresh-answer display divergence

The new Codex continuation rendered Korean top-level text correctly but exposed
raw `$...$` fragments for `\\color{gray}{\\dashrightarrow}` between labels.
Historical formula fixtures did not contain this case. Extend the data-only TeX
compatibility layer with standard named colors and dashed arrow symbols, keeping
the original full source for copy. Normalize line whitespace only in split math
chunks so multiline display fragments do not create extra source-text paragraphs.
Unknown commands still fail visibly instead of silently changing mathematical
meaning. Test the exact fresh answer and mutations; replay it without regenerating
another answer. Supersede build71's candidate archive with the final build72.
