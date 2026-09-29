# Build 270 — Codex CLI path, clean relaunch, no inherited agent session

## Codex was "missing" for OS-1 since 2026-09-26

The ChatGPT/Codex desktop app 26.924 (installed 2026-09-26 00:25 PDT) moved its CLI from
`/Applications/ChatGPT.app/Contents/Resources/codex` to
`/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex` (a launcher that execs
`codex-cli/CodexCLI.app/Contents/MacOS/codex`). `findExecutable("codex")` only knew the old
path, so every Codex probe answered "codex 실행 파일 없음" and OS-1 could not route to Codex.
Build 270 checks the new launcher first and keeps the old path for earlier app versions.

## An install must not hand OS-1 another agent's session

`install-local-verified.mjs` relaunched the app with `/usr/bin/open -g`, and `open` passes its
own environment to the app. Run from inside a Claude Code session (build 269, 2026-09-29), the
relaunched app carried `CLAUDECODE=1`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_OAUTH_SCOPES` …;
every `claude auth status` it ran then reported `loggedIn=false`, so Claude looked signed out.

- The installer relaunches with the environment a Finder launch would have (HOME, USER,
  LOGNAME, SHELL, TMPDIR, text encoding, PATH=/usr/bin:/bin:/usr/sbin:/sbin).
- Every child OS-1 starts (`commandOutput`, the Codex app server) drops an enclosing agent
  session's identity: `CLAUDECODE`, `CLAUDE_CODE_*`, `CODEX_THREAD_ID`, `CODEX_SANDBOX*`.
  The account OS-1 means is still set explicitly (`CLAUDE_CONFIG_DIR` / `CODEX_HOME`).
