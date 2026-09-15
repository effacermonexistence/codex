# Settings / Language / RCC-on-itself Build 126 — Verification Receipt

## Scope

A Codex-style Settings pane (language + backends), English as the shipping default with per-message multilingual answers, a Codex on/off switch honoured by the runtime, and the same RCC write discipline applied to OS-1's own source tree. No credential handling, no conversation-content translation, no weakening of the installer's integrity checks.

## The owner's question, answered honestly

"일 처리할 때 자기 자신한테도 그 RCC 통제 로직 적용하는 거 아니야?" — **No, it did not, and that is now fixed.** OS-1 enforced RCC on the work it routes (scope resolution, prohibitions, REVAS adoption, receipts, task context) but treated its own checkout as an ordinary directory: any number of OS-1-driven write tasks could edit `products/os1-mac-runtime` at the same time. That is exactly what happened today — this session and an OS-1-dispatched Claude run edited `OS1App.swift` concurrently (commit 1e9307c landed mid-edit from the other writer). Build126 adds `acquireOS1SourceWriteLease`: every `workspace_write` run whose workspace resolves inside the OS-1 tree, and `self-update stage` itself, take one cross-process lease (`~/.os1/self-update/source-write-<digest>.lock`), wait up to 180 s announcing the wait, then preserve the request rather than interleave.

## Root causes (from logs)

1. **build125 install "failure" was a false positive.** `install-local-verified.mjs:109` compared `sessions.json` **bytes**. The owner relaunched OS-1 while the installer was between binary swap and verification (app start 18:56:16, install start 18:56:13), and the app re-saved the store with a different JSON key order. Key-normalised comparison of the pre-install snapshot against the current store: **identical** — 84 sessions, 554 messages, queue 314 bytes, same content. Binaries were already swapped and all eight installer checks had passed, so build125 was in fact installed and running; only the final assertion threw. Fixed by comparing parsed content (`assert.deepEqual`), which still fails on any real change and leaves the per-session/per-message preservation checks intact.
2. **The release script silently refused to package since 0.9.57.** `scripts/build-release.sh:7` defaults `OS1_VERSION=0.9.56` and line 183 rejects a runtime/bundle identity mismatch. Every release build from 0.9.57 onward aborted there after staging and signing — the staged app was complete (which is why the local installs worked), but no `.pkg` or manifest was produced and the script exited non-zero. With `OS1_VERSION=0.9.60` the script now completes: `OS-1-0.9.60.pkg`, SHA-256 `f0ff10721103383061076bb92441fcac5b62b30dff3346b54d998258f1380560`, secret scan 22 files / 0 findings. `self-update stage` now passes the bundle's short version to the script, and the self-repair contract tells a staging backend to keep `os1RuntimeVersionString` and `Info.plist` in lockstep.
3. **No user-facing settings existed.** Language and backend visibility were hardcoded Korean/always-Codex, while the product ships to English keyboards.

## Change

- `OS1Settings` (OS1Context): `~/Library/Application Support/OS-1/settings.json`, private, tolerant load (unknown values fall back), defaults **interface `en`, response `auto`, Codex on**. `outputLanguageDirective` is empty for `auto`.
- `OS1Localization` + `os1Tr(korean, english)`: resolution order env override → settings → English; `system` follows macOS. One-second cache, invalidated on save.
- Settings scene (Cmd+,) with Language, Backends and About sections; the app menus, home screen, run statuses, `RuntimeActivity` labels, every `BackendBlocker` message and every `ConnectionFailure` description now carry both languages.
- Codex toggle is enforced end to end: hidden in the rail, never probed or routed by `runTask`, and reported as `BackendHealth.State.disabled` (no repair steps, not a failure).
- Output language travels as its own `--- OS-1 OUTPUT LANGUAGE ---` section placed before the terminal `--- CURRENT USER REQUEST ---`, so native-ingestion identity is unchanged.
- `acquireOS1SourceWriteLease` for OS-1 self-writes; `install-local-verified.mjs` deep-equal store check; `self-update stage` passes `OS1_VERSION`.

## Validation

- Fixtures: Localization 10, Self-update 19, Backend health 20, task context 145, Codex index 10 — full OS1ContextTests suite green.
- CLI self-test: 56 completion-preflight checks (incl. directive placement and terminality, disabled-Codex health, self-update decision matrix, contract wording, pasted-transcript connection guard); model metadata 14; permission orchestration OK.
- Fleet self-test 24. App self-test: backend self-repair 8, self-update report 7, plus provider intent / source continuity / voice / math / selection / pin / queue suites.
- Release: `OS1_VERSION=0.9.60 ./scripts/build-release.sh` completes for the first time since 0.9.56 (pkg + manifest + secret scan).
- Self-tests are pinned to Korean via `OS1_INTERFACE_LANGUAGE=ko` so a user's English interface cannot flip fixture expectations.

## Live self-install (the end-to-end proof)

`os1 self-update stage` (build126) → intent written with checks `release-build / version-string / runtime-self-test / fleet-self-test / app-self-test: PASS`, staged app SHA-256 `53daf3a0fed8a5bcbe1469cf9674dedbac21c143980fc3da6df4e717859ada71`, source commit 1e9307c. **The running build125 app then installed it with no human step**: it saw the intent on its next tick, flushed state, launched the installer detached, and the installer swapped the binaries, ran all eight suites, restarted the app and wrote `~/.os1/recovery/self-update-build126-2026-09-15T021601Z/install-receipt.json` — `runtime/app/queue/parallel/fleet/queue-fork/composer/steering/existing conversations: PASS`, sessions `84 -> 84`, `signerRotation false`, fleet agent restarted (pid 57421). The relaunched build126 app posted the receipt into the conversation that asked for the change ("야 너 셀프로 OS1 고칠 수 있냐?"): *"OS-1이 자기 자신을 build 126 (0.9.60)로 교체했습니다 · 설치기 검사 9개 PASS · 세션 84→84 · 소스 커밋 1e9307c · 영수증 …"*. The intent was consumed and the outcome marked reported, so it is never posted twice.

A third gap, found because build127's receipt never appeared in the conversation: recovery and self-update ran **inside** the native sidebar poll, which reads the backends' own apps and can stall for a whole cycle (its `sidebarPollRunning` guard then skips every later tick). Build128 gives them their own 3-second tick in `RootView` (`runMaintenanceTick`), independent of any backend read, and the app self-test now asserts that tick is inert for a fixture store — an assertion that immediately caught the tick adopting the real machine's pending receipt into a fixture conversation, which is now blocked by a `customStorageRoot` guard.

A follow-up gap found by live check: `os1 backend-health --refresh` still probed Codex after the toggle was switched off, so the health record and the fleet heartbeat disagreed with the rail. Fixed in build127 (`probeBackendHealth` honours the setting; `BackendHealth.disabledCatalogSource` is the one spelling both sides use; disabled wins even over a stale non-empty catalog), and build127 was staged and **self-installed the same way** — the second consecutive proof of the pipeline.

## Residual (documented)

- Deep runtime diagnostics (BackendHealth diagnosis lines, self-repair notes, governance and receipt strings, source-preparation wording) remain Korean-first; the interface-language switch covers menus, home, statuses, activity labels, blocker and connection messages, and Settings. Next localization pass should take the diagnosis/receipt layer.
- Conversation content is never translated: `auto` means the backend answers in the language the user typed, which is the shipping default for an English-keyboard audience writing Korean.
- Turning Codex off is a local setting; it does not change what another machine advertises to the fleet.
