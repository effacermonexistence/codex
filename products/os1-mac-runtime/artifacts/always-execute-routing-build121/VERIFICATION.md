# Always-Execute Routing Build 121 — Verification Receipt

## Scope

Provider-preference fallback, Claude read-only lane bounded shell, dontAsk-denial handling, informal write-scope markers, integration of the OS-1-driven UI branches, Codex-style attachments.
No external deployment, held OS1 queue replay, auth/session migration, or Codex/Claude user-configuration change.
Paid model calls: the replays below (build121 debug: one `sonnet/medium`; build121 installed: `sonnet/medium` rejected by the route service, then `opus/xhigh`).

## Root cause (from logs)

- task-events `c49fd192-…` 13:20:26Z: "…그거 좀 제대로 고치지 코덱스랑 일치시키면 돼 코덱스 봐봐…" → `executableProviderPreference` refused: "이 작업에 필요한 Codex 실행 환경이 없습니다 (… 한도 … spark …)". The constrained backend was unavailable and the code refused instead of using the other available backend; the wording ("고치지", "일치시키면") also resolved as read-only.
- build121 debug replay of "GitHub … 최신 상태 확인해": first with Bash added but the process sandbox active, `gh` was auto-denied network/keychain under dontAsk (`sandbox_violations … user denied`), and one denial became a terminal `policyDenied` ("도구 실행이 권한 정책에 의해 차단됐습니다 (Bash; 1회)") even though opus had produced a complete answer via public web reads.
- The three UI fixes made through OS-1 (`os1/composer-drag-drop-files-20260914` f62e480, `fix/sidebar-row-tap-and-divider` 80331c3, `os1/provider-rail-selection-20260914` 4904317) existed only as remote branches; the installed app never received them.

## Change

- `executableProviderPreference`: unavailable pinned/constrained backend → the other available backend with a `RuntimeActivity` routing notice; only "no backend at all" stops before a model.
- `ClaudeReadOnlyShell`: Bash added to the read-only lane with prefix allow rules for inspection commands (`git status/log/diff/show/branch -a/…`, `gh auth status/run/pr/workflow/release/repo view`, `railway status/logs`, `wrangler r2 object get`, version probes); `--settings` `sandbox.excludedCommands` lets those run outside the process sandbox; no `cat`/`ls`/`curl`.
- `parseClaudePrintResult(boundedShell:)`: in that lane `permission_denials` are the bound, not a terminal verdict; the answer is judged on content. `providerOutputDeclaresCapabilityFailure(boundedShell:)`: a stated bound is not a refusal.
- `execute()`: the read-only Claude lane is no longer refused for shell-bound objectives; it receives `ClaudeReadOnlyShell.directive`.
- `ScopeResolution.positiveEdit`: "고치지/고치자/일치시켜/일치시키/통일해/통일하/맞춰/때려넣/넣어줘".
- UI: merged the three OS-1-driven branches (no conflicts); `ComposerAttachment` chips (image preview via ImageIO thumbnail, file icon+name), window-wide `onDrop` in `RootView`, composer drop retained, `+` picker feeds the same chips, attachments sent as the quoted "참조 파일 경로" block, attachments alone are sendable.
- Self-test: 48 completion checks + permission orchestration (bounded-lane fixture) OK; app self-tests (composer 28, sidebar 33) OK.

## Build / install

- Build: 121 (0.9.56), universal, development signer unchanged (`signerRotation: false`)
- Release package SHA-256: `e9affa7eea858c06bdff12631820ce96703f791dbde5529a1e35861d0688ccd2`
- Staged app hash: `9b12e63cbd497efffa4322363d0d1eec8956cedd416efc94e4b6df95189f418d`
- Staged CLI hash: `f552c5ce5cb98657d9f5765da75fc82fda8c99d04844424dc2a587015d89844f`
- Install receipt: `~/.os1/recovery/always-execute-routing-build121-20260914T134812Z/install-receipt.json` (all installer checks PASS; sessions `82 -> 82`; queued entry preserved; installer waited for `inFlight: 0`)

## Replays (workspace `/Users/LUA`, request "GitHub effacermonexistence/codex 최신 상태 확인해 — 최근 푸시된 브랜치 5개와 열린 PR 목록만 정리해")

| build | result |
| --- | --- |
| 120 installed | `sonnet` answer rejected by the route service; `opus` blocked by the sandbox, one dontAsk denial → terminal `policyDenied`; run failed |
| 121 debug | `claude/sonnet/medium` adopted (41 s) with real `gh` data (5 branches, 12 open PRs) |
| 121 installed | `sonnet/medium` → route-service retry (quality), `opus/xhigh` adopted (137 s), governance `8158d1d1-ec7e-47b8-a303-854282885ef4` |

## Not claimed

The attachment chips and window-wide drop were verified by compilation and the app's own self-tests, not by a scripted UI drag; the owner's red-team check covers the visual behaviour. Prefix allow rules are a guard against accidental writes in the read-only lane, not a security boundary (the workspace_write lane already has full Bash). OS-1-driven code changes still need a build and a verified local install to reach the running app; this receipt documents that integration for build121 only.
