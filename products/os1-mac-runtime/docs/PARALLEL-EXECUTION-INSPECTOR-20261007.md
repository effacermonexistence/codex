# OS-1 parallel execution and adjacent inspector windows

## Locked object
One owner objective can delegate independent bounded subtasks. The owner can inspect the actual decomposition and each worker from the sidebar's pink marker, without starting another run. Preserve existing conversations, queues, branding, backend manual-open behavior and source governance. Handy is outside the trust domain and is not inspected or modified.

## Executed design
```
owner submission + exact conversation/request hash
   ├─ explicit self-contained arithmetic provider roster
   │      └─ one fresh owned subprocess per target (no planning research)
   └─ suitable compound project/research objective
          └─ read-only planner → validated 2–3-node plan
                 ├─ read-only preparation → fresh native sessions
                 └─ authorized independent implementation
                        → clean Git project + disjoint owned relative paths
                        → one detached private worktree per writer
                        → verify every candidate vs exact base/owned paths
                        → disposable integration worktree
                        → recheck original → parent applies once
          → original primary executor → existing verification/adoption
   → source-bound private graph + native activity
   → pink marker → graph window → node window → observed native-scope window
```

Workers have separate submissions, native sessions, activity/stdio/cancel files and process custody. Parent death/cancellation drains owned children. Ordinary OS-1 project writers and parallel parents share the same cancellable original-project integration lease; the parent retains it through final verification. Granted private children skip that lease so independent implementation really overlaps. Worker candidates are not owner completion. Only parent integration and final objective verification can adopt the result. Dirty/non-Git projects, overlapping ownership, protected policy/tests/install paths, dependencies between writers, or changed original state do not receive parallel write grants; the existing original execution is preserved. A failed integration retains candidates privately. No worker installs, publishes or self-updates OS-1.

Full Codex/Claude Code and bounded GPT/Claude chat remain distinct execution surfaces. Explicit fan-out preserves that distinction before dispatch; unavailable targets are not silently substituted. ChatGPT app handoff is not a remotely observed model result and stays partial/blocked. The spoken four-surface arithmetic request is parsed without inventing questions. Larger/ambiguous provider rosters do not turn into unrelated log-research tasks.

## Read-only UI
A normal-level native window shows the parent objective, worker dependency relations, actual state, provider/model/effort, execution scope, isolated workspace/owned paths and observed progress. Selecting a node opens a keyed adjacent detail window. Native nested scope IDs are shown only when present in actual native progress events; opaque IDs do not establish native model identity or completed work. No fake percentages or child relationships are created. Windows are placed right-adjacent where the screen permits and clamped/cascaded inside the visible screen otherwise. Passive telemetry never fronts a window or resumes a model. Closing inspectors closes their detail chain, not the work. New plans invalidate old detail windows. An inactive legacy session can display its exact historical submission/conversation-bound disk graph even if its old stored wording changed; this is never adopted as a current live run.

## GUI restart custody
A GUI restart is not proof that its coordinator stopped. The app verifies the exact conversation/submission/dispatch hash and existing private parent lock. A busy original parent is observed separately (not a fabricated Process/ActiveRun), same-conversation reconciliation/replay stays held, and its recorded graph remains inspectable. The Stop control uses that exact original submission cancellation channel and retains custody until actual release. On lease release the existing outbox is consulted first; missing output remains uncertain. The owner-authorized stop of prior runs retained 245 conversations and 7 queued entries; this is not permission to replay them.

## Focused verification boundary
- Debug compile/typecheck: PASS.
- Context suite: PASS, including route grammar and legacy graph decoding.
- Real local subprocess fixtures: 68 coordinator/isolation checks + 11 explicit-fanout checks PASS. Includes four-process overlap, target-order preservation, distinct identities, cancellation, parent death, two Git writers, committed/untracked patch capture, owned-path refusal and original mutation refusal.
- GUI restart custody: 14 actual lock/private-store checks PASS.
- Actual production window/button fixtures: 25 inspector + 40 existing tree checks PASS. Source-to-surface binding, native-scope drilldown, plan invalidation and passive-focus boundary covered.
- Structural wiring: 19 checks PASS; supplements, not substitutes for executed fixtures.
- Backend focus: 1,137 structural checks PASS.
- Provider calls for these tests: 0. No fresh paid-model demonstration was generated.
- Final installed/runtime and recovery receipts are separate artifacts. A source commit or this document is not installation proof.

## Primary pattern/research sources consulted
Independently implemented patterns; Superset source is ELv2, not copied.
- https://docs.superset.sh/orchestration
- https://docs.superset.sh/workspaces
- https://docs.superset.sh/agent-sessions
- https://docs.superset.sh/agent-status
- https://github.com/superset-sh/superset/blob/main/plugins/superset/skills/orchestrate/SKILL.md
- https://arxiv.org/abs/2210.03629
- https://arxiv.org/abs/2310.01798
These support separate execution/custody, external feedback and explicit verification, not universal reliability or model-quality guarantees.

## Current implementation (build 353 source, 2026-10-08)

The sections above record the 2026-10-07 design and its verification boundary and are unchanged. This section describes the executed path in the current source (`Sources/OS1/ParallelAgentCoordinator.swift`, `Sources/OS1/main.swift`) and two defects observed in one real use of installed build 353.

### Executed path
- Planner and workers are conditional low-cost candidates. `ParallelAgentRuntime.shouldPlan` gates the graph; the planner is a read-only `GovernedDelegation` whose prompt states that `ownedPaths` "is a candidate relative ownership list only, never authority. The runtime retains all authority." Workers return "preparatory evidence" or "a candidate patch; the parent alone integrates". Nothing a child returns is reference parity or a quality certificate.
- The parent retains original authority. A rejected plan finishes the planner node `failed` with "Planner candidate rejected; original execution preserved." and the graph switches to the fallback primary; a failed worker or a failed integration also falls back, keeping private candidates. The primary runs the original owner prompt through the existing `runTask`/`runWorkflowTask`, with adopted preparation marked "PREPARATION EVIDENCE ONLY" and subordinate to later owner steering. The primary is adopted only on `complete`, exit code 0 and a verified native record.
- Native child input is lossless. `losslessChildArguments` replaces the child's `--prompt` with a private `request.utf8` (`--request-file`), so macOS argv cannot decompose Korean and break an isolated writer's grant hash; each child's `governed-delegation.json` carries `parentObjectiveSHA256` of the original owner request bytes.
- Quality correction and the self-repair tail belong to the parent and run after quality/outbox/adoption; see `TASK_QUALITY_ADOPTION_BUILD346.md`, "Current implementation".

### Observed defect 1: valid read-only plan rejected for owned-path hints
Submission `CF4E4E9C-2D7A-4BE8-88D2-7AFCB91F2D0D`, plan `AFA3435E-D13D-4368-A6B9-246E6D6A95FC`, 2026-10-08. The planner child (activity: provider `codex`, model `gpt-6-luna`, effort `low`) returned two valid `read_only` inspections, each with `ownedPaths: ["products/os1-mac-runtime/Sources/"]`. The preserved `planner/planner-output.txt` has SHA-256 `8ab5c46963a19a8aeed308a1bfbcae1dddf8902f88330bfd20896b6dd187315e`; `planner-normalization.json` recorded `[]`. The strict decoder rejected the whole plan, the planner node ended `failed` with "Planner candidate rejected; original execution preserved.", and the expensive primary ran alone.

Repair (`clearReadOnlyOwnedPathHints` inside `parallelDraft`): for a task that is explicitly `scope: "read_only"`, a nonempty `ownedPaths` is a non-authoritative read-target hint. The list is cleared before strict validation and each clearing is recorded beside the raw output as `read_only_owned_paths_cleared:<task id>:<original paths>`; the planner's instructions, order and scopes are never rewritten and `planner-output.txt` keeps the producer bytes. Nothing else is normalized into acceptance: unknown or unrecognized scope, a scope-less task with paths, missing write ownership, overlapping writers, non-string path elements and truncated JSON are still rejected, and unparseable output records no transformation. The coordinator fixture replays the captured bytes (SHA above) as the regression; the plan was not regenerated.

### Observed defect 2: hidden native sub-agents in the fallback primary
In the same submission the fallback primary (graph node "Primary fallback · original task", started 2026-10-08 19:16 local, cancelled by the operator about 24 minutes later) let the native Claude CLI spawn its own built-in sub-agents. Operator-observed, not re-derived locally: two Explore agents on `claude-opus-5-5` with 172 tool calls. Those children bypassed OS-1 model routing, the governed graph, custody and the inspector.

Repair (`ParallelAgentRuntime.managedDelegation`, one `@TaskLocal`): the scope is set for actual OS-1 children (`--parallel-agent-child`, read-only agent or isolated writer, in `main.swift`) and for the coordinator's primary, planned or fallback. Inside the scope only:
- Claude: `claudeArguments` passes the permission arguments through `claudeDenyArguments`, which keeps every existing denied tool and adds `Agent,Task` to `--disallowedTools` (read-only lane: `mcp__*,Agent,Task` in place; write lane: a new `--disallowedTools Agent,Task`, always followed by a named option).
- Codex: the OS-1-owned app-server process gets `-c features.multi_agent=false -c features.multi_agent_v2=false` appended to its config overrides.
Outside the scope every argument is byte-identical. No `~/.claude` settings, Codex global config, desktop settings, model/effort profile, authentication or manual backend behavior is changed, and no tool, path or permission is granted.

### Verification boundary for this section
- Debug build of all products and the model-free fixtures: `os1 self-test` covers the coordinator fixture (captured-plan regression, hint counterexamples, TaskLocal scope, Claude/Codex argument shape) and the `claudeArguments` regression (managed deny only inside the scope, explicit flag on/off, variadic placement).
- Observed 2026-10-08 on this source: `swift build` of all products complete; `os1 self-test` exit 0 with the permission-orchestration self-test OK, parallel task agents 108 checks PASS, concurrent route fan-out 18 checks, provider calls 0. The fixtures need the real temporary directory and must run outside a nested sandbox.
- CLI capability only: Claude Code 2.1.290 lists `--disallowedTools <tools...>`; `codex -c features.multi_agent=false -c features.multi_agent_v2=false features list` reports `multi_agent` and `multi_agent_v2` as `false` (codex-cli 0.160.1).
- Not verified here: a live model run showing the native CLIs withholding sub-agents under these flags; no new model test or benchmark was generated. The tool-call count is operator-reported. The installation receipt is produced by the OS-1 host and is separate from this document.
