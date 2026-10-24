# Current-attempt native display observation

The existing OpenClaw Core task remains the sole scheduler/adopter. This patch only makes its existing cards/tree/windows able to display each actual child's native observations.

- The adapter allocates its ordinary native receipt path, then scopes a TaskLocal display sink to that one ticket. No parent activity-file permission is added. Native dispatch establishes the owned session; subsequent bounded public lifecycle progress is captured without assistant prose, requested model/effort, raw commands/results or reasoning.
- The host's actual execution cwd and ticket-declared owned paths are display scope, not observed file modifications or a permission grant. Unsupported/private ownership path syntax remains unknown rather than a partial empty declaration.
- Private sidecars are `.os1/rcc-runtime/native-display/<attempt UUID>.json`. Exact task/request/child/attempt/candidate/config and receipt are bound. Same-session/turn duplicate observations are suppressed. Directory/file custody is owned, private, nofollow, regular, single-link, bounded and stable. Optional telemetry failure never retries or changes task adoption.
- Actual model/effort are not selected configuration or ACK. After the exact terminal receipt is persisted/read back, only native metadata can populate them. Codex requires its exact own session + turn_context turn_id. Claude requires one assistant in the exact session whose visible text hash equals that receipt's output AND timestamp is inside this native attempt's start/finish interval; duplicate/old/missing anchors remain unknown. Claude effort remains unknown when not exposed. Thinking and tool bodies never enter the graph.
- Existing UI receipt loaders merge only current-attempt sidecar evidence. Terminal settings additionally require exact receipt SHA and verified native session/turn. Selected settings remain separately labelled in progress text. No previous graph values carry into a new attempt.
- Existing authenticated status polls refresh display callbacks at most once/second for unchanged Core revision. New lifecycle revisions emit immediately. No extra RPC, planner, model, liveness claim, CLI graph relabel or App-owned run is created.

## Verification boundary

Deterministic synthetic fixtures cover observed/selected separation, current/old/late Claude rows, missing/foreign anchors, cancelled events, old attempt/receipt mismatch, privacy, private custody, symlink/FIFO refusal and same-revision refresh. Native transport publication and original UI loader callsites have a source wiring test. Builds and these fixtures do not establish installed GUI behavior, quality parity or quota savings; Root must integrate/install and verify the real owned app surface separately.

Research inspected before method selection: [intrinsic self-correction limitations](https://arxiv.org/abs/2310.01798), [Self-Refine](https://arxiv.org/abs/2303.17651). Applied mechanism: observed native evidence and deterministic feedback, not model-generated self-report as execution proof. These papers are background, not efficacy evidence for this patch.
