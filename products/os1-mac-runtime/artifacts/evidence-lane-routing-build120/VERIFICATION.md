# Evidence-Lane Routing Build 120 — Verification Receipt

## Scope

Provider-preference preflight, quoted-output intent classification, capability-refusal heuristic exemption and one bounded read-only contract retry.
No external deployment, held OS1 queue replay, auth/session migration, Codex/Claude configuration change, or external message sending.
Paid model calls: four Claude `opus/xhigh` turns for the replays listed below (one rejected on build119, three adopted).

## Root cause (from logs)

- task-events `de8c1b88-…` 12:37:27Z "…QM이랑 GR자료 R2에서 다 가져와 설명해 … obj function 잡고 스케마 다 짜" → `executableProviderPreference` forced Codex because the prompt mentions R2 with fetch wording; the Codex catalog was empty (weekly quota exhausted, spark excluded by the context budget) → "이 작업에 필요한 Codex 실행 환경이 없습니다" before any model.
- task-events `49479d78-…` 12:37:55Z: the user pasted OS-1's own preparation answer plus "고쳐"; `asksRecoveryReadiness` matched "복구 기준점(Gold 포인터)" and "가능하냐" → "복원 가능 여부를 묻는 질문에는 변경 권한을 사용하지 않습니다".
- build119 installed replay `d25033ae-…`: the `opus/xhigh` answer said it did not execute anything (correct for a snapshot-only request) and matched the capability-refusal markers → `capability_unavailable`; the route service had accepted the artifact, so the run ended with "서버의 완료 판정과 실제 실행 증거가 일치하지 않아" and no retry.

## Change

- `executableProviderPreference`: the Codex-only constraint applies only to shell-bound objectives (no supplied evidence and not a write profile); when it still refuses, the message carries the catalog exclusion reasons (`ModelAvailability` now records quota/context notes in the catalog source).
- `OS1SelfOutput.stripQuoted` (new): OS-1 output lines are removed before `asksRecoveryReadiness` classifies the user's request.
- `providerOutputDeclaresCapabilityFailure(evidenceSupplied:)`: with OS-1 evidence attached and no repair requested, an answer noting it did not run anything is not a capability refusal.
- Local-rejection guard: when the route service reports complete but the read-only answer fails a local contract, one bounded retry is requested with `BackendContinuation.diagnostic` in the handoff (never for write profiles, never beyond the attempt limit).
- Self-test: 44 completion checks.

## Build / install

- Build: 120 (0.9.56), universal, development signer unchanged (`signerRotation: false`)
- Release package SHA-256: `68dd7e00158ee5f21b8d443dcba754236e45b8779ee7559d9173c9e52b30fba5`
- Staged app hash: `38e76245732502f3f39229a22c46754a312b59bfa45340b9f4fbdfbb5d684416`
- Staged CLI hash: `3428c24478bda9cd2a846c70c4898ee26047b927815c03258b8e1f9cc7a21de9`
- Install receipt: `~/.os1/recovery/evidence-lane-routing-build120-20260914T130027Z/install-receipt.json` (all installer checks PASS; sessions `75 -> 75`; queued entry preserved)
- Build119 (same change set minus the retry and the refusal exemption) was installed at `…build119-20260914T124746Z` and replaced by build120; both receipts are kept for rollback.

## Replays (workspace `/Users/LUA`, request "QM이랑 GR자료 R2에서 다 가져와 설명만 해")

| build | result |
| --- | --- |
| 118 installed (before) | preflight refusal, no model: "이 작업에 필요한 Codex 실행 환경이 없습니다" |
| 119 debug | R2 snapshot `live-r2-opt-research-map+separate-qmgr-v1` attached; `claude/opus/xhigh` adopted (148 s) |
| 119 installed | same snapshot; answer rejected as `capability_unavailable` (honest "no execution" note), run ended — motivated build120 |
| 120 debug | adopted first try (118 s); answer ends with the retrieved-subset limitation |
| 120 installed | adopted first try (106 s), governance `76ccd184-d09a-43ab-9cb3-5f981c464b80`, 0 recovery checkpoints |

## Not claimed

The bounded retry path was exercised only by self-test (continuation diagnostic) — both build120 replays passed on the first attempt. A read-only shell objective without any Codex model still stops before a model call, now with the reason. The user's original write-scope request ("… obj function 잡고 스키마 다 짜") was not replayed here because it would create files in the OS-1 checkout and, under the user's remote-completion contract, commit and push them.
