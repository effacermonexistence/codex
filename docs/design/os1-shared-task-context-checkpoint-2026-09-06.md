# OS-1 shared task context — checkpoint (2026-09-06, Claude pass)

Companion to `os1-shared-task-context-2026-09-06.md` (design) and
`os1-redteam-repair-2026-09-06.md` (red-team pass). This file records the
exact state at the checkpoint so a later session can resume without
re-deriving it. Every status below is labelled by what actually produced it.

## Exact objective

OS-1 owns one shared task state per conversation (objective, scope and
prohibitions, confirmed decisions, project baseline with three separate
version facts, all bound sources with provenance, backend bindings with
ingestion cursors, executions, verified facts vs claims, next steps,
blockers, event log). Codex and Claude receive that state in every handoff
(`os1-session-handoff-v3`) and return it; results that arrive after a newer
request or decision are preserved but not adopted; work done directly in the
native Codex/Claude app is read back incrementally without re-importing what
OS-1 itself sent. "인스타그램 수정 좀 하자 준비해" resolves through the
common preparation capability (project alias → adapter), not an Instagram
string exception.

## HEAD and changed files

- Worktree: `/Users/lua/Documents/Codex/2026-08-30/new-chat/work/os1-redteam-fixes`
- Branch: `os1/redteam-fixes-20260906`, HEAD `35408df` before this pass's
  commits (5 ahead / 7 behind `origin/main` `a0dd62b`; merge-base `155c920`).
- New: `Sources/OS1Context/TaskContext.swift`,
  `Tests/OS1ContextTests/TaskContextTests.swift`,
  `docs/design/os1-shared-task-context-2026-09-06.md`, this file.
- Modified for the task context: `Sources/OS1Context/SourceContext.swift`
  (handoff v3), `Sources/OS1Context/ProjectMaterials.swift`
  (`SCVCustodyRecord`), `Sources/OS1/main.swift` (runtime wiring),
  `Sources/OS1App/OS1App.swift` (app wiring),
  `Tests/OS1ContextTests/SourceContextTests.swift` (v3 test + fixture hook).
- Modified earlier in the same session (red-team hardening, separate commit):
  `Sources/OS1/Fleet.swift`, `Sources/OS1Context/RuntimeActivity.swift`,
  `Sources/OS1/main.swift` (`nonGitWorkspaceHash`), `scripts/observe-execution-focus.swift`,
  `scripts/verify-focus-ownership.swift`, eight `scripts/verify-*.mjs`,
  `docs/design/os1-redteam-repair-2026-09-06.md`.

## Installed build (not replaced by this pass)

- App `~/Applications/OS-1 CLODEX.app` 0.9.26 build 76; CLI `~/.local/bin/os1`
  reports `OS-1 Runtime 0.9.26 (project-material-acquisition-before-execution)`.
- LaunchAgent `com.os1.fleet-agent` running (pid recorded in the red-team doc).
- Nothing under `~/Applications`, `~/.local/bin`, `~/Library/LaunchAgents` or
  `~/Library/Application Support/OS-1` was written by this pass.

## Tests completed and where the result came from

All binaries below were built with `swiftc` from the published tree (no
SwiftPM in the sandbox). Test processes ran under two small interposer
dylibs (`DYLD_INSERT_LIBRARIES`) that only redirect the per-user temp
directory (`confstr`, `_dirhelper`, Foundation's `TemporaryItems`
item-replacement path) and the home directory (`getpwuid`) into
sandbox-writable folders; nothing in the product code was changed for that.
A plain `perl`/`timeout` wrapper strips `DYLD_*` (SIP), so a tiny own
launcher (`alarmrun`) was used.

| check | result | produced by |
| --- | --- | --- |
| `runTaskContextFixtures` (sections A–O, 94 checks) | PASS | scratch harness and the `OS1ContextTests` executable |
| `OS1ContextTests` executable (13 regression groups: recovery 72, execution/outbox 16, research bundle 16, voice 6, takeover 37, project materials 46, task context 94, source context + handoff v3) | PASS | `$TMPDIR/tc/OS1ContextTests`, log `$TMPDIR/ctxtests.log` |
| `OS1HookSupportTests` (8 groups) | PASS | `$TMPDIR/tc/OS1HookSupportTests` |
| `os1 self-test` (incl. new pins: routing scope without a source, preparation intent, prepared-state bundle, task-context prompt block, pasted-receipt guard, legacy snapshot baseline) | PASS | `$TMPDIR/tc/os1 self-test`, log `$TMPDIR/os1-selftest.log` |
| `OS-1 CLODEX.app --self-test` (incl. `taskContextSelfTest`; sidebar sync 33 checks, 0 model calls, 0 backend writes) | PASS | app linked with `swiftc` against SwiftMath 1.7.3 built from the local SwiftPM cache with a synthesized resource-bundle accessor; log `$TMPDIR/app-selftest.log` |
| offline integration run 1: `os1 run --prompt "OS1 앱 수정 좀 하자 준비해"` in the git worktree | PASS | local `work_preparation` control answer (workspace, HEAD revision, three baseline lines, next steps), receipt id/sha match, 0600, `taskContext` returned with the workspace source and the execution |
| offline integration run 2: case B `"야 인스타그램 수정 좀 하자 준비해"` with an existing SCV snapshot attached through a v3 handoff | PASS | reuse path: no download, "이미 연결된 … 재사용" answer, receipt `source_inherited_from_context=true`, `taskContext.projectID = scv-instagram` with the verified source; a legacy snapshot without a stored baseline now derives the recovery pointer from its source records (operating release stays "none recorded" until GitHub is read) |
| live R2 / GitHub reads for the fresh preparation flow (`scvProjectEvidence`, `scvOperatingRecord`) | NOT RUN | `gh api` fails on the sandbox proxy TLS chain; wrangler refuses without an API token in non-interactive mode |
| installed-flow verification (cases A and B on the installed app) | NOT RUN | install not possible from this sandbox |

Also fixed and verified in this pass: a user pasting an earlier OS-1 answer
with its receipt line ("… REVAS adopted · native record verified …") was
classified as a protected-material request and answered with the guard text
(observed live: Fleet job `a18fce3f`). `OS1ReceiptText.stripped` removes
OS-1's own receipt lines before classification; fixture O and a self-test pin
cover the exact pasted request and a genuine route-internals request.

## Failed tests

None failing among the ones that ran. Two fixture failures during development
(compound prohibition ordering; `liveVerified` leaking between sections) were
fixed before this checkpoint.

## Processes and work in flight

- No OS-1 run, install, or deployment was started by this pass.
- Fleet agent untouched; `~/.os1/fleet/main-agent-active.json` untouched.

## Decisions taken in this pass

- **Bare preparation is answered by OS-1 itself.** "야 인스타그램 수정 좀 하자
  준비해" (no described change) acquires or reuses the materials, records the
  three version facts and answers locally without a model call. A described
  change ("… 가격 안내가 두 번 나가는 버그 수정해줘, 준비해") is handed to a
  backend with the materials and the task-context block. The earlier fixture
  that treated case B as a backend modification was changed accordingly.
- **Preparation dispatch requires a registered project** (alias table or the
  conversation's bound project). A migrated `workspace:<name>` project never
  produces a local control answer; "테스트 작성 시작하자" stays a normal request.
- **A second registered project (`os1-clodex`) uses the local-workspace
  adapter** through the same intent → registry → baseline → prepared-state path.

## Unresolved design decisions

1. First ingestion of a long native history is bounded to the last 40 records
   per binding (older turns stay reachable in the native app). A user-facing
   "load earlier native turns" control is not implemented.
2. Automatic decision capture is limited to explicit `결정:` / `decision:`
   lines. Free-form "let's go with X" stays a request until the user states
   it as a decision.
3. The prepared-state answer for a reused attachment is a summary (materials
   are not re-printed). A "show the materials again" follow-up goes through
   the normal explain path with the attached snapshot.
4. Routing scope normalization now rewrites prohibitions with or without an
   attached source (`sourceRoutingTask`); the self-test pin that expected the
   old source-gated behaviour was updated, not removed.

## Next safe steps (in order)

1. Outside the sandbox: `swift build -c release` (or `scripts/build-release.sh`),
   run `OS1ContextTests` (expects "13 regression groups passed"),
   `os1 self-test`, and `OS-1 CLODEX.app --self-test`.
2. With the installed `gh`/R2 credentials: `os1 run` for case B in an empty
   workspace ("야 인스타그램 수정 좀 하자 준비해") and confirm the local
   prepared-state answer names v151 (recovery pointer), v157 (recorded
   operating release, from `docs/scv-instagram-v157-custody.md`) and "운영
   서버 실제 상태: 미확인"; then send the same request again and confirm the
   reuse path ("이미 연결된 …", no new R2 download, same snapshot sha).
3. Install per `scripts/install-os1.sh` after recording a new recovery
   directory under `~/.os1/recovery/` (never reuse an existing one); verify
   sessions.json migrates in place (every session gets `taskContext`, nothing
   removed; queue/pins/drafts preserved).
4. Publish only the native-runtime subtree and `docs/design` on a clean
   branch from `origin/main`; do not push `os1/redteam-fixes-20260906` itself.

## Do not touch

- `products/scv-instagram/recovery/LATEST_GOLD.json`, `LATEST.json`, any dated Gold.
- SCV production, Omar.system state, ManyChat, Cloudflare plan/billing.
- Existing `~/.os1/recovery/*` directories and the installed build's session store.
- Uncommitted changes in the other worktree (`os1-real-session-sync`).
