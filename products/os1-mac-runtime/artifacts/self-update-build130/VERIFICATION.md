# OS-1 Self-Install + Settings/Language Build 130 — Verification Receipt

## Scope

OS-1 now repairs and replaces itself end to end, keeps doing so with no window open, and exposes user settings (language, backends) the way Codex does. Applied to builds 125→130. No credential handling, no installer bypass, no queue replay.

## The owner's question, answered

"일 처리할 때 자기 자신한테도 그 RCC 통제 로직 적용하는 거 아니야?" — **아니었다. 이제 적용한다.** RCC governance covered the work OS-1 routes (scope, prohibitions, REVAS adoption, receipts) but treated OS-1's own checkout as an ordinary folder: any number of OS-1-driven write tasks could edit it simultaneously, which is exactly what happened today (this session and an OS-1-dispatched Claude run edited `OS1App.swift` concurrently; commit 1e9307c landed mid-edit). Build130 adds `acquireOS1SourceWriteLease` — one cross-process writer per checkout for every `workspace_write` run inside the OS-1 tree and for `self-update stage`, announcing the wait and preserving the request after 180 s instead of interleaving.

## Five defects found and fixed, each from evidence

| # | Defect | Evidence | Fix |
| --- | --- | --- | --- |
| 1 | Installer compared the session store **byte-for-byte** | build125 install threw at `install-local-verified.mjs:109` while all 8 suites passed; key-normalised diff of the snapshot vs the live store: identical (84 sessions, 554 messages) | `assert.deepEqual` on parsed JSON; content changes still fail, per-message preservation checks unchanged |
| 2 | Release script **silently refused to package** since 0.9.57 | `OS1_VERSION` defaults to 0.9.56; line 183 rejects a runtime/bundle identity mismatch, so the script exited non-zero after staging | `self-update stage` passes the bundle's short version; first full package since 0.9.56: `OS-1-0.9.60.pkg`, SHA-256 `f0ff1072…0560`, secret scan 22 files / 0 findings |
| 3 | Recovery and self-update ran **inside the native sidebar poll** | build127 left build128's intent `pending` for 15+ minutes while the app was idle; the poll's `sidebarPollRunning` guard skips every later tick when a backend read stalls | own 3-second maintenance tick |
| 4 | A receipt that could not be posted was still **marked reported** | build127: `reported=true`, no message in any conversation, no `self_update` task event | consume only after the summary is verified on disk; an already-visible receipt is consumed without duplicating |
| 5 | **A background-relaunched app has no window**, so every periodic loop was dead | after the installer's `open -g`, `System Events` reported `windows = 0`; the app was alive but applied nothing and posted nothing | the maintenance loop is owned by `SessionStore` (live root only), not by `RootView` |

## Change

- `SelfUpdate` (OS1Context): intent beside the staged app, private outcome records under `~/.os1/self-update/outcomes`, apply decision (newer / fresh ≤24 h / ≤3 attempts / idle / stuck-apply retry), and the self-repair contract handed to any backend whose workspace is the OS-1 tree.
- `os1 self-update stage | apply | status`; the app applies a staged build when idle, launches the installer detached so it survives its own restart, and posts the receipt into the conversation that staged it.
- Settings (Cmd+,): interface language (**English default**, 한국어, follow-system), response language (**auto** = answer in the language the user typed; or pinned), Codex backend on/off. `settings.json` is read by every OS-1 process.
- Codex off is honoured everywhere: hidden in the rail, never probed or routed, `BackendHealth.State.disabled` (no repair steps), and `has_codex=false` in the fleet heartbeat.
- `os1Tr` localization across menus, home, statuses, activity labels, blocker messages and connection errors; self-tests pin Korean via `OS1_INTERFACE_LANGUAGE=ko`.

## Live proof

| Build | How it was installed | Result |
| --- | --- | --- |
| 126 | **by OS-1 itself** (running build125 saw the intent, ran the installer, restarted) | 9 installer checks PASS, sessions 84→84, receipt posted into "야 너 셀프로 OS1 고칠 수 있냐?" |
| 127 | **by OS-1 itself** | 9 checks PASS, 84→84; receipt lost → defect 4 found |
| 129 | one manual `self-update apply` (build127's stalled path, defect 3) | 9 checks PASS, 84→84 |
| 130 | one manual `self-update apply` (build129 had no window loop, defect 5) | 9 checks PASS, 84→84 |

Final state, with the app running and **zero windows**: it posted the pending build129 and build130 receipts into the right conversation by itself; `os1 self-update status` → installed 130, outcomes 126/127/129/130 all reported, 0 pending intents. `os1 backend-health --refresh` → `claude usable`, `codex disabled` (설정에서 꺼짐). Fleet snapshot → Air `has_claude=true has_codex=false`.

## Tests

Localization 10, Self-update 19, Backend health 22, task context 145, Codex index 10, source context 13 groups; CLI 56 completion-preflight checks + model metadata 14 + permission orchestration; Fleet 24; app self-tests incl. self-update report 12 and backend self-repair 8. Release build green.

## Residual

- Deep runtime diagnostics (health diagnosis lines, self-repair notes, governance/receipt strings) are still Korean-first; the next localization pass should take them.
- The installer still relaunches with `open -g`, so the window stays closed after a self-install; the store-owned loop means that no longer stops any work, and the owner can reopen the window from the Dock at any time.
- Codex quota returns 2026-09-19 20:51 Z; the toggle is currently off by the owner's request, which is independent of that.
