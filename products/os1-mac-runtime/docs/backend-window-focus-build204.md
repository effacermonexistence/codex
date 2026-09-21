# Backend window focus — build 204

Owner report: routing a task to Codex or Claude made the backend window jump in
front of whatever application the owner was using. Opening a backend on purpose
is fine; automatic routing, reconnection and progress checks are not. OS-1 must
not compensate by pinning its own window above other applications either.

## Root cause

`CodexDesktopTransport.ensureRunning` ran on every automatic Codex route and
called:

```
/usr/bin/open -g -b com.openai.codex
```

`-g` suppresses only `open`'s own activation request. For an application that is
**already running**, `open -b <bundle id>` is not a launch — it delivers a reopen
Apple Event, and Codex Desktop answers that event by showing and focusing its
window. So every route pulled Desktop to the front, exactly as reported.

Measured on 2026-09-20 with Codex Desktop (`com.openai.codex`,
`/Applications/ChatGPT.app`) already running and Safari frontmost: the command
exited 0 and the foreground moved to Codex.

## Fix

A running Desktop owner is reached through its IPC socket
(`~/.codex/ipc/ipc.sock`); its window is not involved and must not be touched.
The launch decision now comes from one policy, `OS1Context/BackendWindowFocus`:

| state | decision | effect |
| --- | --- | --- |
| Desktop already running | `use_running_owner` | nothing is sent; IPC serves the turn |
| Desktop not running | `background_launch` | cold `open -g -b`, which carries no reopen event |

`ensureRunning(threadID:launch:)` takes that decision from the caller, so the
transport cannot decide to activate anything on its own. The same policy now
gates both native reveals: `codexDesktopVisibility` and `claudeDesktopVisibility`
check `BackendWindowFocus.mayActivateBackendWindow(mode.focusIntent)`, and only
`--desktop-reveal always` — which is set solely by the owner's "Open in Codex /
Claude Desktop" controls — maps to `explicit_user_reveal`. The app keeps routing
with `--desktop-reveal background` (record-only).

Nothing pins OS-1 above other applications; the structural gate below fails the
build if anything tries.

## Verification

Paired measurement, same process, same conditions, current policy first so the
legacy reproduction cannot contaminate it
(`scripts/observe-desktop-launch-focus.py`, no model call, no thread opened, no
turn started):

| phase | Desktop running | foreground before → after | backend activations |
| --- | --- | --- | --- |
| `current_policy` (`use_running_owner`, `launched: false`) | yes | `com.apple.Safari` → `com.apple.Safari` | 0 |
| `legacy_open_g_b` (pre-fix call) | yes | `com.apple.Safari` → `com.openai.codex` | 1 |

Report: `artifacts/backend-window-focus/paired-legacy-vs-current.json`
(the `artifacts/` tree is untracked).

Regression coverage, all green in `scripts/build-release.sh` for build 204:

- `scripts/test-backend-window-focus.py` — 72 structural checks: the running
  owner is never reopened, every `ensureRunning` call states a launch decision,
  both reveals gate on the policy, no always-on-top API anywhere, and every call
  that can bring an application forward is on a reviewed allowlist.
- `Tests/OS1ContextTests/BackendWindowFocusFixture.swift` — 13 policy checks.
- `os1 self-test` — the transport itself: `launch: false` performs no launch and
  still validates the thread identity; the reveal-mode → intent mapping holds.
- `scripts/test-codex-desktop-transport.py` — 5 live socket cases, plus the
  updated source invariants.

Mutation check: forcing `desktopLaunch` to always return `backgroundLaunch` made
both `OS1ContextTests` and `os1 self-test` fail (`Backend window focus policy
validation failed`); reverting restored green.

## Boundary

Claude Code routing is headless and never had a window to raise. The official
Claude sign-in dialog still comes forward on purpose — it is an owner-blocking
credential prompt reached only after a real authentication failure, not a
backend window, and it already refuses to stack a second window on a pending
one. That is the one remaining intentional foreground change, and
`scripts/test-backend-window-focus.py` pins it: exactly one `tell me to
activate` may exist in the runtime and it has to belong to the official
`claude auth login` flow, so the pattern cannot spread to other paths.
