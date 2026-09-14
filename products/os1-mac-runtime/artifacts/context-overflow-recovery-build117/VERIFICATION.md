# Context-Overflow / Exhausted-Quota Recovery Build 117 — Verification Receipt

## Scope

Backend failure classification and recovery routing only.
No external deployment, held OS1 queue replay, auth/session migration, Codex configuration change, or external message sending.
Paid model calls: the proof replays below (one Claude `sonnet/medium` turn each on the debug and installed builds) plus the earlier failed spark attempts that motivated the change.

## Root cause (from logs, not inference)

1. Codex rollouts `01a09f72-07f4 / -2230 / -3b1b`: `task_complete.error.codex_error_info = context_window_exceeded`; `session_meta.base_instructions` = 901,558 B (the account's `model_instructions_file`, 859,674 B ≈ 198,728 tokens measured in the user's own desktop session); `model_context_window` for `gpt-5.3-codex-spark` = 121,600.
2. OS1 build114 `completionFailureOutcome` mapped that error to `quality_failure`; the route service escalated effort on the same model (`cx_spark_low → high → xhigh`); `codexTurnBlocker` returned nil → `unclassified` → "실행 결과를 확인하지 못했습니다".
3. `account/rateLimits/read`: `rateLimitsByLimitId.codex.primary.usedPercent = 100` (resets 2026-09-19T20:51:15Z), credits 0, `ordinaryUsageAllowed = false`. `CodexQuota.excludedModels` therefore removed every 272K-window model; the advertised catalog was `[gpt-5.3-codex-spark]` (confirmed by build116 instrumentation `context_overflow_observed … catalog=gpt-5.3-codex-spark`). The read-only Claude lane was then refused pre-dispatch because "테스트 해보자" matched `promptRequiresShellCapability`.

## Change

- `BackendRecovery`: new `context_overflow` blocker; message; `reported(in:)` detection; `alternate` allows a backend switch (no writes happened); `classifiedBlocker` keeps the cause when the workspace is untouched.
- `main.swift`: `codexTurnBlocker` recognises `context_window_exceeded`; `completionFailureOutcome` reports `capability_failure`; Codex re-route with the overflowing slug removed before the alternate backend; feasibility questions no longer require the shell lane; build 117.
- `ModelAvailability.codexCatalog`: announces quota exclusions with the reset time; `CodexContextBudget` pre-excludes models whose cached `context_window` is below the configured base-instructions size plus margin.
- Fixtures/self-test: BackendRecovery fixtures, completion checks (31), backend protocol recovery (41), account model metadata (14).

## Build / install

- Build: 117 (0.9.56), universal (`x86_64 arm64`), development signer unchanged (`certificate root 8d96b9dd…`, `signerRotation: false`)
- Release package SHA-256: `258f2a8d35f04a45131b05c359abeb6b83d3ce259529282aa56eb8716708d902`
- Staged app hash: `ed86ded983be1bd2f3c9b2dec22e3319ed967616d3d578fbf4ef6f55961f8a83`
- Staged CLI hash: `1fd48636ab03d89aa0ae6d2af204429f70004d72abe00c8363af5d79ccfd3de7`
- Install receipt: `~/.os1/recovery/context-overflow-build117-20260914T111313Z/install-receipt.json` (runtime/app/queue/parallel/fleet/queue-fork/composer/steering PASS; conversations/messages/pins/drafts/native bindings PASS; sessions `72 -> 72`; queued entry preserved with `--preserve-queue`)
- Earlier steps on the same path: build115 (`…build115-20260914T104547Z`) and build116 (`…build116-20260914T105835Z`), both installed and replayed; their receipts remain for rollback.

## Replay of the original failing request

Request (verbatim, as recorded in task-events `2c6ca143-…` at 2026-09-14T10:23:58Z): `한번 테스트 해보자 여기서 오마일 시스템, 이거 오마일 시스템이 아니라 OS1 클로덱스 여기서 내가 보고 니가 오륜하는 것 니가 다 고칠 거거든 가능하냐?\`

| build | governance attempts | result |
| --- | --- | --- |
| 114 (original) | codex/spark low, high, xhigh → quality_failure ×3 | `unclassified` — "실행 결과를 확인하지 못했습니다" |
| 115 | codex/spark low → capability_failure; claude sonnet/opus/opus → not dispatched (shell-lane rule) | failed, `capability_unavailable` |
| 116 | same as 115 (Codex re-route found no other advertised model) | failed, `capability_unavailable` |
| 117 (installed) | claude/sonnet/medium → adopted (8,645 ms), governance `d3f344b7-d159-4eac-af11-a551ffd4b032` | `status: complete`, 0 recovery checkpoints |

The build117 answer states correctly that the session is read-only and that edits need a write profile; no fabricated tool activity.

## Not claimed

No Codex turn succeeded in this verification: the account's weekly Codex quota is exhausted until 2026-09-19T20:51:15Z, and the only unmetered model cannot hold the configured base instructions. When the quota resets, the new catalog filter keeps `gpt-5.3-codex-spark` excluded while the base-instructions file stays this large; larger-window models will be advertised again automatically.
