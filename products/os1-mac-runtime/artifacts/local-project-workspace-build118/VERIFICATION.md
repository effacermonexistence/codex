# Local Project Workspace Build 118 — Verification Receipt

## Scope

Preparation intent, local-workspace project root resolution and backend candidate ordering only.
No external deployment, held OS1 queue replay, auth/session migration, Codex/Claude configuration change, or external message sending.
Paid model calls: one Claude `sonnet/medium` turn for the write-path proof on the debug build.

## Root cause (from logs)

- task-events `cdfb4b0f-…` 2026-09-14T12:03:13Z objective "야 여기서 OS1 수정 가능하냐?" → `claude/fable/low`, read-only, `source=0B`; Claude answered that the OS-1 source was not bound.
- Claude session `cf28ef19…`: the candidate list OS1 handed over held 8 lexicographically first registry roots (`…/Codex/2026-08-13/*`, `…/2026-08-15/*`); the OS-1 checkout `…/Codex/OS1-Air-Takeover-20260913-c8410129bd1556e7` (registered, contains `products/os1-mac-runtime/Package.swift`) was cut off.
- `PreparationIntent.detect` returned nil for the feasibility question (no prepare/continue marker, read-only scope), so the `os1-clodex` local-workspace adapter never ran; and that adapter binds the conversation's own workspace, which was HOME.
- Debug replay of a change request ("…한 줄만 추가해") produced a bare preparation because `modifies` depended on a fixed verb list that lacks "추가".

## Change

- `PreparationIntent`: feasibility markers shared with the shell-capability rule; feasibility question + registered project + change verb → `prepare` without `modifies`; a project-naming write-scope sentence is modifying even without a listed verb; bare preparations stay non-modifying.
- `LocalProjectWorkspace` (new): marker per local project (`os1-clodex` → `products/os1-mac-runtime/Package.swift`); root resolution upward from the requested workspace, else the most recently changed registered root (fleet job and temp roots excluded); alternates reported.
- `main.swift`: the run workspace becomes the resolved project root for a local-workspace project named in the request or already bound in the task context; a named project without any resolvable root fails with an explicit instruction instead of binding HOME.
- `WorkspaceDiscovery.context`: OS-1 requests only list roots that contain the OS-1 runtime.
- Self-test: 37 completion checks (intent, root resolution, modifying vs bare preparation, plus build115–117 cases).

## Build / install

- Build: 118 (0.9.56), universal, development signer unchanged (`signerRotation: false`)
- Release package SHA-256: `f1329ef323036f8e782041731b6480aae3a1f6b324450e5466f45a661dec3156`
- Staged app hash: `50c9a494f378f46dfd290a51a87f029327a1784ae99ad09130962d6358f636f9`
- Staged CLI hash: `a057977aec4738c50a0297ee1ba80477bceaf86a305bf479c41ada8ddeee1da9`
- Install receipt: `~/.os1/recovery/local-project-workspace-build118-20260914T121951Z/install-receipt.json` (all installer checks PASS; sessions `73 -> 73`; queued entry preserved)

## Replays

| request (workspace `/Users/LUA`) | build | result |
| --- | --- | --- |
| 야 여기서 OS1 수정 가능하냐? | 117 (installed, before) | claude/fable/low read-only: "OS-1 소스 리포지터리는 이 세션에 바인딩되어 있지 않습니다" |
| 야 여기서 OS1 수정 가능하냐? | 118 debug and 118 installed | local `work_preparation`, no model: "OS-1 CLODEX 작업 준비가 됐습니다 · 작업 폴더: …/OS1-Air-Takeover-20260913-c8410129bd1556e7 · 현재 버전 @4ab10e4377e8" |
| OS1 앱 저장소의 …/RUN_CARD.md 맨 끝에 'proof: build118 write path' 한 줄만 추가해 | 118 debug (before the verb fix) | bare preparation, no change |
| same | 118 debug (after the verb fix) | claude/sonnet/medium adopted (132.7 s); exactly that line was added inside the checkout; restored afterwards |

## Observed hazard (documented, not changed)

The Claude backend working inside the OS-1 checkout followed the user's global remote-completion contract: it committed the proof line (`e045e24`, current branch), then created and pushed `os1/run-card-build118-proof-20260914`. OS1 verified the native record but not the remote claim. The local commit was dropped, the remote branch deleted, and the run card restored; the branch under review stayed at `4ab10e4`. Any OS1 write task inside an `effacermonexistence/*` checkout should be expected to commit and push by that contract.
