# Quota fallback implementation evidence

Implementation-stage record — 2026-09-20 UTC. This is source-readiness evidence, not a release, installation, or live-runtime receipt.

## Scope and change

- Preserved the existing uncommitted `quota/auth/output/connection/telemetry/path/stage` worktree changes; no reset, checkout, version bump, staging, commit, push, installation, or restart was performed.
- Reviewed the quota/auth routing path in `ModelAvailability.swift`, `BackendHealth.swift`, `BackendRecovery.swift`, `ClaudeQuotaBackoff.swift`, `main.swift`, and their deterministic fixtures. The source keeps quota exhaustion distinct from `loggedIn == false`; a usable Codex rail prevents an unnecessary Claude-login repair path.
- Reproduced one contract defect: the self-repair contract asked for `.build/debug/os1 fleet-self-test` without the configuration required by the built CLI. The unconfigured command reported `OS-1 configuration is missing; reinstall OS-1`; it was a local configuration-path failure, not a Claude-auth or quota result.
- Minimal correction: `Sources/OS1Context/SelfUpdate.swift` now supplies the same explicit `OS1_CONFIG="$HOME/Applications/OS-1 CLODEX.app/Contents/Resources/config.json"` for `fleet-self-test` that it already required for `self-test`.

## Evidence

Full command output and timestamps: `.build/quota-fallback-verification-20260920.log`.

| UTC run | Command | Exit | Result |
| --- | --- | ---: | --- |
| 20:30:42–20:30:45 | `swift build` | 0 | All debug products built after the contract correction. |
| 20:30:45–20:30:51 | `swift run OS1ContextTests` | 0 | Quota pre-execution rejection: 40 checks; backend recovery: 128; backend health: 31; unified execution: 82; workflow/source-context suites passed. |
| 20:30:51–20:30:57 | `.build/debug/OS1ContextTests` | 0 | Same built-binary deterministic suite passed. |
| 20:31:23–20:31:28 | `OS1_CONFIG=… .build/debug/os1 self-test` | 0 | Native session, routing, recovery, and adoption self-test passed. |
| 20:31:28 | `OS1_CONFIG=… .build/debug/os1 fleet-self-test` | 0 | Fleet self-test: 24 checks passed. |
| 20:31:28–20:31:33 | `node scripts/test-fixture-telemetry-isolation.mjs .build/debug/os1` | 0 | Fixture self-test did not write auth/quota events into owner telemetry files. |
| 20:31:33 | `PYTHONDONTWRITEBYTECODE=1 python3 scripts/test-workflow-stage-policy.py /Users/LUA/.os1/policy-audit/quota-repair-20260920/candidate-v31/src` | 0 | `PASS`; 8 checks; architecture=`source_review`, implementation=`executed_change`, verification=`native_record`. |
| 20:31:55–20:32:06 | `.build/debug/OS1App` self-test matrix | 0 | `--self-test`, shell, composer, steering, sidebar queue, queue fork, and parallel all passed. |
| 20:33:52 | `git diff --check` | 0 | No whitespace errors across the current worktree, including this record. |

The full output for each command, including the final diff check, is retained at the log path above.

## Auth/quota boundary

- The quota results above are deterministic fixture regressions. They prove only the tested source behavior; they do not establish a current account quota state.
- No Claude CLI/auth command was run. Current Claude authentication is therefore **not checked** in this implementation stage, and no logout conclusion is made.
- The configured fleet test proves the local test path can load the provided config. It does not prove that the recorded source revision is installed, deployed, or live.

## Implementation boundary

Execution metadata for server verification: backend `codex`; reasoning effort `xhigh`; exact exposed model label unavailable.

Independent workflow verification remains pending. The only source change made in this stage is the `fleet-self-test` configuration-path correction above; all prior uncommitted work remains preserved.


## Independent verification — stage 3/3

This section supersedes the earlier “independent workflow verification remains pending” status. Independent source-readiness checks were executed on 2026-09-20 UTC; no production or installed-runtime claim is made.

### Source and historical execution inspection

- Workspace HEAD remained `5bf8096b738d229dd65d39c17debd97a8425ec87`. Reviewed the current tracked diff and the new quota-backoff/test files, rather than accepting the handoff's success statement.
- Inspected primary record `/Users/LUA/.codex/sessions/2026/09/20/rollout-2026-09-20T13-20-13-01a0c079-f7d8-7c61-b406-24d25cf0c9d2.jsonl`. Both supplied stage locators point to this same record. Its native tool calls/results show the pre-existing changes, the unconfigured fleet failure, the configured retry, the one-line `SelfUpdate.swift` patch, and the implementation report writes. No uncertain external action was replayed.
- Metadata correction: primary `turn_context` entries identify the architecture producer as `gpt-6-astra` / `high` and the implementation producer as `gpt-5.6-terra` / `xhigh`; this replaces the earlier implementation note that its exact model was unavailable. These entries identify execution configuration, not correctness.
- This independent stage used backend `codex`, model `gpt-6-astra`, reasoning effort `high`. Machine receipt: `.build/independent-quota-20260920/results.json`.

### Source-path findings

1. **Application/control flow:** quota cooldown and explicit `loggedIn == false` take distinct paths. Unknown/malformed auth output does not become logout. A usable backend prevents unnecessary login repair. Automatic alternative-provider retry is bounded to a proved pre-execution quota rejection; pinned-provider and uncertain/dispatched work are not blindly replayed.
2. **OS/runtime:** inspected command entry points and fixture isolation before execution. The fleet self-test loads config before its temporary local fixtures, so supplying `OS1_CONFIG` fixes the observed invocation defect without weakening its assertions. All seven app flags enter dedicated test modes rather than starting the normal application flow.
3. **Continuity/data:** reviewed workspace-path canonicalization, output extraction, connection-command classification, and workflow/task-context tests. Queue/fork, steering, and parallel suites exercise temporary session stores and controlled child processes; they do not replace the installed app's conversations or queues.
4. **Security/isolation:** malformed auth remains unknown; quota retry requires rejection evidence and unchanged workspace where applicable. The dedicated telemetry test injected sentinel activity/journal files and observed unchanged bytes. The main runner removed inherited `OS1_ACTIVITY_FILE`/`OS1_EVENT_JOURNAL`, while retaining only the explicit local config path needed by the CLI tests. No Claude CLI/auth command or credential change was performed.
5. **Deployment/recovery:** current source and tests are the acceptance object. Pre-existing `Resources/Info.plist` and `Sources/OS1/SelfUpdateCommands.swift` bytes were preserved. No version bump, release staging, commit/push, installation, or installed-OS-1 termination/restart occurred in this stage.

### Independently executed checks

All paths below are relative to `products/os1-mac-runtime`. Per-command output is in `.build/independent-quota-20260920/`; `results.json` records full timestamps, commands, exit codes and log identities. Build/test execution used the authorized local compiler/test permission path after inspecting the previous sandbox failures; no provider task was dispatched by this test runner.

| UTC start–end | Command | Exit | Log |
| --- | --- | ---: | --- |
| 20:37:32–20:37:54 | `swift build` | 0 | `build.log` |
| 20:37:54–20:38:00 | `swift run OS1ContextTests` | 0 | `swift-run-context.log` |
| 20:38:00–20:38:06 | `.build/debug/OS1ContextTests` | 0 | `context-binary.log` |
| 20:38:06–20:38:10 | `OS1_CONFIG="$HOME/Applications/OS-1 CLODEX.app/Contents/Resources/config.json" .build/debug/os1 self-test` | 0 | `cli-self-test.log` |
| 20:38:10–20:38:11 | `OS1_CONFIG="$HOME/Applications/OS-1 CLODEX.app/Contents/Resources/config.json" .build/debug/os1 fleet-self-test` | 0 | `fleet-self-test.log` |
| 20:38:11–20:38:15 | `OS1_CONFIG="$HOME/Applications/OS-1 CLODEX.app/Contents/Resources/config.json" node scripts/test-fixture-telemetry-isolation.mjs .build/debug/os1` | 0 | `telemetry-isolation.log` |
| 20:38:15–20:38:16 | `PYTHONDONTWRITEBYTECODE=1 python3 scripts/test-workflow-stage-policy.py /Users/LUA/.os1/policy-audit/quota-repair-20260920/candidate-v31/src` | 0 | `stage-policy.log` |
| 20:38:16–20:38:17 | `.build/debug/OS1App --self-test` | 0 | `app--self-test.log` |
| 20:38:17–20:38:20 | `.build/debug/OS1App --self-test-shell` | 0 | `app--self-test-shell.log` |
| 20:38:20–20:38:20 | `.build/debug/OS1App --self-test-composer` | 0 | `app--self-test-composer.log` |
| 20:38:20–20:38:21 | `.build/debug/OS1App --self-test-steering` | 0 | `app--self-test-steering.log` |
| 20:38:21–20:38:21 | `.build/debug/OS1App --self-test-sidebar-queue` | 0 | `app--self-test-sidebar-queue.log` |
| 20:38:21–20:38:21 | `.build/debug/OS1App --self-test-queue-fork` | 0 | `app--self-test-queue-fork.log` |
| 20:38:21–20:38:27 | `.build/debug/OS1App --self-test-parallel` | 0 | `app--self-test-parallel.log` |
| 20:38:27–20:38:27 | `git diff --check` | 0 | `diff-check.log` |

Fresh output confirms: quota-rejection 40 checks, backend recovery 128, backend health 31, unified execution 82, task context 329, source/output 13 regression groups, fleet 24, and workflow-stage policy 8 checks. The seven app test invocations all exited 0; composer reported 28, steering 32 plus replacement 83, sidebar queue 4, queue/fork 44, and parallel 44 checks. These are suite-reported counts, not a deduplicated total.

### Findings, boundaries and preservation

- No blocking defect was reproduced within the requested source-readiness acceptance scope. No production source or acceptance test was edited during independent verification.
- `swift build` emitted two non-fatal warnings in the existing candidate's `Sources/OS1/main.swift`: line 6290, redundant nil coalescing on a non-optional string; line 7376, optional interpolation using its debug description. Recorded rather than silently fixing unrelated diagnostic formatting during verification. Build and required tests still exited 0; warning-free compilation was not claimed.
- Before editing this report, all 1,332 baseline tracked/nonignored-untracked regular files matched their entry SHA-256 values, and the tracked binary diff matched the entry snapshot. This includes unrelated pre-existing work, which was neither executed nor changed. Final preservation receipt: `.build/independent-quota-20260920/scope-audit.json`.
- Current Claude authentication and real-account quota remain **not checked**. Synthetic quota/auth fixtures establish only the tested classification and fallback behavior. No logout inference or current quota reset time is asserted. Local fallback tests do not establish a live cross-provider reroute.
- App self-tests establish local fixture behavior, not a visual redesign, installed patch, public deployment, or production recovery. No visual change was requested, so no unrelated preview or manual UI relaunch was performed.
- Method reference: inspected the abstract of [Large Language Models Cannot Self-Correct Reasoning Yet](https://arxiv.org/abs/2310.01798). Its external-feedback distinction informed the use of fresh process exits, deterministic assertions, sentinel bytes, and source/diff checks rather than a previous model's self-report. The paper is not evidence that this patch works.
- Independent verdict: **PASS for the requested source-readiness scope**. No remaining in-scope test blocker. OS-1's subsequent release/install pipeline remains separate and was not executed here.
