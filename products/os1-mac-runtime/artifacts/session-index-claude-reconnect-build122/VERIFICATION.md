# Session-Index / Claude-Reconnect Build 122 — Verification Receipt

## Scope

Codex session-index read hardening, transcript busy timeout, integration of the Pro's Claude connection target. No external deployment, held OS1 queue replay, credential handling, or Codex database writes. Paid model calls: none (fixtures and self-tests only).

## Root cause (from logs)

1. "Codex session index could not be read": `codexSessions()` opened `~/.codex/state_5.sqlite` (WAL, written continuously by Codex Desktop) with no `sqlite3_busy_timeout`; a checkpoint or exclusive-mode writer at that instant failed `sqlite3_prepare_v2` immediately. Reproduced live: the identical query succeeds moments later (500 rows) — pure transient contention.
2. "Failed to authenticate: OAuth session expired and could not be refreshed": the Air's Claude Code keychain token could not refresh (`claude auth status --json` → `loggedIn:false`; refresh token likely rotated by the Pro sharing the account). OS1 classified it correctly (`.authenticationRequired`) but had no recovery lever, unlike GitHub/R2.
3. The OS-1 Fleet job for this exact request (`17b70b3c-…`, routed to the Pro) ended `effectsUncertain`; its partial work was pushed as `fix/claude-oauth-reconnect-20260914` (e3a433f) and was reviewed and integrated here (probe flag `--claudeai` verified against the installed CLI; the connect gate requires a connection verb, so a bare "클로드" mention cannot hijack a request).

## Change

- `CodexSessionIndex` (OS1Context, new): read-only index access — busy timeout 1.5 s, bounded retries on transient lock errors, then an `immutable=1` snapshot open that answers under a held lock (may trail the WAL by moments; acceptable for a browse list). `codexSessions()`/`codexSession(id:)` now use it; a surviving failure appends the underlying SQLite cause to the dialog. `codexTranscript` gains a busy timeout.
- Pro's commit e3a433f merged: "claude" connection target — read-only `claude auth status --json` probe, OAuth-expiry classification, bounded `claude auth login --claudeai` via the existing lease/cooldown recovery ("클로드 연결시켜").
- Fixtures: `CodexSessionIndexFixture` (WAL fixture reproduces the reader lockout via exclusive locking mode; checkpoint-before-lock mirrors Codex's steady state; 10 checks incl. snapshot answer, ordering/filtering, archived-record lookup, missing-db error) + Pro's TakeoverTests additions (46 checks).

## Build / install

- Build: 122 (0.9.56), universal, development signer unchanged
- Release package SHA-256: `8314e30bff0f5858cd661eb773767cbb0dbe3962e2b12d5f98347614e1e73a91`
- Install receipt: `~/.os1/recovery/session-index-claude-reconnect-build122-20260914T211040Z/install-receipt.json` (all installer checks PASS; sessions `83 -> 83`; queue preserved)
- First install attempt failed at staging with `ENOSPC` (the data volume had run out during the day's seven release builds); regenerable build caches and scratch (~1.4 GB) were removed, the staged app re-verified (codesign + version), and the install repeated cleanly. The failed attempt swapped no binaries (the running app stayed build121 throughout).

## Validation

- Fixture suite: Codex session index 10 checks (lockout answered via immutable snapshot); OS1 takeover 46; governance 43; task context 145; source context 13 groups — all green.
- CLI self-test: completion preflight 48 checks, permission orchestration OK. App self-test OK.
- Installed `os1 version` → `session-index-claude-reconnect-build122`; app relaunched (pid recorded in the install log).

## Residual (documented)

- The Air's Claude backend stays down until the owner completes the browser login — "클로드 연결시켜" in OS-1 (or `claude` → `/login`); OS1 never touches the credentials.
- Codex models return at the 2026-09-19 20:51 Z weekly quota reset.
- The data volume is at 100 % (≈2.2 GiB free after cache cleanup); larger reclamation involves the owner's data (236 GB takeover restore mirror, Codex history databases) and needs an explicit owner decision.
