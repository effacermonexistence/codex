# Backend Self-Repair Build 124 — Verification Receipt

Build123 (installed 2026-09-15 01:02Z, receipt `~/.os1/recovery/backend-self-repair-build123-20260915T010238Z/`) delivered everything below except a completable login; its live test showed the headless `claude auth login` child waiting for a pasted code that nothing could supply. Build124 replaces that child with the owner's own Terminal window and is the delivered build.

## Scope

A preflight with no usable backend now repairs itself instead of ending the request: diagnosis, the official Claude login the owner approves in the browser, continuation in place, a preserved hold that the app replays by itself when health recovers, and truthful fleet capacity flags. No credential handling, no held-queue replay of dispatched work, no paid model calls in fixtures or self-tests.

## Root cause (from logs and code)

1. `runTask` preflight (main.swift) threw "선택한 Claude 실행 환경이 없고 Codex 실행 환경도 없습니다" from `executableProviderPreference` with no failure notice; the app recorded `.unclassified/notDispatched`, showed "Needs attention", and nothing ever retried. Reproduced on the installed build122: `claude auth status --json` → `loggedIn:false`; Codex weekly bucket 100 % used, `resetsAt` 2026-09-19T20:51:15Z.
2. The bounded official-login lever (`withConnectionRecovery("claude")`: lease, 60 s cooldown, 300 s limit, gated by `OS1_ALLOW_AUTHENTICATION=1`, which the app already grants) existed only behind the explicit "클로드 연결시켜" control.
3. `fleetHeartbeatNode` advertised `has_claude/has_codex` from executable presence (Fleet.swift:419-420). `os1 fleet-snapshot` showed the Air as `true/true` while both backends were dead; the gateway (`fleet-model.ts` eligibility) placed five consecutive owner jobs on it, each dying at the same preflight.

## Change

- `BackendHealth` (OS1Context, new): per-backend state (`usable`, `logged_out`, `quota_exhausted` + `recoversAt`, `context_budget`, `missing`, `probe_failed`), repair order, Korean diagnosis/hold/waiting wording, private cache `~/Library/Application Support/OS-1/backend-health.json` (stale or future-dated = unknown).
- `BackendBlocker.backendUnavailable` + `BackendFailureNotice.diagnosis` (optional; older stores decode unchanged).
- `CodexQuota.exhaustedGeneralResetDate`; `ActiveCodexCatalog.quotaResetsAt`; `ModelAvailability.claudeAuthProbe` (read-only `claude auth status --json`).
- `runTask`: `observedBackendHealth` after the catalogs; when both are empty and no local answer exists → activity "OS1이 작업 이어가는 중" with the diagnosis → `selfRepairBackends` (reconnect Claude through the existing lease/cooldown gate, re-probe the catalog, continue the same request) → otherwise `backend_unavailable` notice with the diagnosis and the earliest recovery time, and the request is held. Every preflight refreshes the health record.
- `os1 backend-health [--refresh]` (read-only, cached 60 s).
- App: the hold shows OS-1's diagnosis instead of the generic line and a "백엔드 복구 대기 · … 시 자동 재실행" status; `resumeBackendRecoveries` (every sidebar refresh, 3 s) replays a preflight-only `backend_unavailable` hold exactly once per observed recovery (`backendRecoveryIdentity` = health `checkedAt`), spawns the read-only probe at most once a minute while a hold exists, and never touches dispatched or write-uncertain failures.
- Fleet: `fleetAdvertisedCapabilities(health:…)` — capacity = executable present AND usable; unknown = no capacity; the heartbeat never blocks (background refresh, ≤15-minute-old record while refreshing).
- Build124: `runClaudeLoginInTerminal` replaces the headless `claude auth login` child in `withConnectionRecovery("claude")` (used by both "클로드 연결시켜" and the self-repair): writes `auth-flows/claude-login.command` (0700), opens it in Terminal, polls the read-only `claude auth status --json` every 3 s for ≤300 s, honours cancellation, then re-probes the catalog and continues the same request.

## Build / install

- Build 123 (0.9.57): staged app SHA-256 `030e338c…afa8`, CLI `b9bb3e64…68b9`; receipt `~/.os1/recovery/backend-self-repair-build123-20260915T010238Z/install-receipt.json` — all checks PASS, sessions `83 -> 83`, fleet agent restarted (pid 88176).
- Build 124 (0.9.58, delivered): universal, development signer unchanged (`8d96b9dd…`, `signerRotation:false`); staged app SHA-256 `78799ab1b5a19ba3688ce17424c89561d5110ae8420f082f400a91524f6fcbdb`, CLI `99f3e84239400667b9635633b0ec70e1b5c932078c8779fd78d5c599a594d0ac`; receipt `~/.os1/recovery/backend-self-repair-build124-20260915T011504Z/install-receipt.json` — checks runtime/app/queue/parallel/fleet/queue-fork/composer/steering/existing-conversations all PASS; sessions `83 -> 83`; queue preserved; fleet agent restarted (pid 97752); `os1 version` → `backend-self-repair-build124`.

## Validation

- Fixtures: Backend health 20 checks (classification from catalog notes, repair order, wording, private cache, staleness/future/garbage/oversize); Codex session index 10; full OS1ContextTests suite green.
- CLI self-test: completion preflight 51 checks (incl. `selfRepairBackends` headless/permitted/declined paths, reset-date exposure, Codex classification); account model metadata 14; permission orchestration OK. Fleet self-test 24 checks (dead/usable/unknown capacity flags). App self-test: Backend self-repair 8 checks (waits on dead health, replays once per recovery, never a dispatched failure).
- Installed build, live (Air, 2026-09-15 01:03Z):
  - `os1 backend-health --refresh` → `claude: logged_out`, `codex: quota_exhausted`, `recoversAt 2026-09-19T20:51:15Z` (probe 1.6 s).
  - Preflight without login permission (`os1 run`, no `OS1_ALLOW_AUTHENTICATION`) → exit 1 with the three-line diagnosis, failure file `blocker=backend_unavailable stage=not_dispatched`, activity `recovering` carrying the repair plan.
  - Fleet snapshot after the restarted agent's first heartbeat → Air `has_claude=false has_codex=false` (was `true/true` on build122); the agent's background probe refreshed the health record at 01:03:48Z without blocking the heartbeat.
  - Preflight with login permission (as the app runs it), build123: activity `authorizing`; the headless `claude auth login --claudeai` child printed "Opening browser to sign in… Paste code here if prompted >" and, with `redirect_uri=https://platform.claude.com/oauth/code/callback` (`code=true`, identical under `script` pty), could not be completed by anyone; after 300 s the run held the request with the diagnosis and "공식 Claude 로그인이 완료되지 않았습니다(…300초…)". This is the finding that produced build124.
  - Preflight with login permission, build124 (01:15:40Z): activity `authorizing` with "터미널 창에 공식 Claude 로그인을 열었습니다…"; `auth-flows/claude-login.command` (0700) created and opened in Terminal, where `claude auth login --claudeai` waited for the owner's pasted code; the owner did not complete it within 300 s, so the run ended as the documented hold (exit 1, `backend_unavailable`, diagnosis + "다음 요청에서 다시 열 수 있습니다(60초 간격)"). The completion branch (status flips to logged-in → catalog re-probe → same request continues) is covered by the CLI self-test's permitted path and will be exercised live the first time the owner finishes the Terminal login.

## Residual (documented)

- The official login still needs the owner: approve in the browser, then paste the displayed code into the Terminal window OS-1 opened (Claude Code's `auth login` offers no localhost-callback mode). OS-1 waits ≤300 s per attempt with a 60 s cooldown, never sees the code or credentials; a login finished after the wait is picked up by the app's health probe and replays the hold. From the headless fleet agent no Terminal is opened (no `OS1_ALLOW_AUTHENTICATION`).
- Codex models return at the 2026-09-19 20:51Z weekly reset; the app replays held requests by itself once the health record reports a usable backend.
- Holds recorded by build122 or earlier carry the old `unclassified` blocker and are not auto-replayed; a manual "다시 시도" runs them under the new preflight.
- Cross-node self-handoff (running a HOME conversation on the Pro when the Air is dead) is not part of this build: fleet jobs require a committed GitHub revision and the Pro's agent has been offline since 22:31Z.
- During the login wait the activity text shows the standing label "공식 로그인 승인 대기 중 · 승인 후 같은 작업을 이어갑니다"; the longer explanatory sentence is emitted just before it.
