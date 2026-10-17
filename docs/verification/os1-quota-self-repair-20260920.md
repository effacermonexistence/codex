# OS1 quota routing and autonomous self-repair — 2026-09-20

## Verified scope

The owner requested quota/auth separation, available-backend fallback and OS1-driven self-repair. Unrelated product directories were neither staged nor published by this completion step.

## Implementation

Runtime source commit: `f40f2f36adbc75c0f7da845d3cfc177e11cbe40f` (build195, 0.9.129).

- Distinguish Claude quota cooldown, explicit logged-out state and failed auth probing. Quota is not evidence of expired authentication. A 300-second observed cooldown is not a provider reset-time claim.
- Use an available Codex rail before attempting Claude login repair. Native quota rejection permits a bounded alternate-backend attempt only after verified pre-execution rejection and unchanged scope; uncertain side effects remain protected from duplicate replay.
- Preserve architecture/implementation/verification phase contracts. Architecture analysis is not required to have modified source files. Preserve explicit owner execution intent and scoped prohibitions.
- Normalize execution paths before backend/lease use; isolate fixture telemetry from owner activity; accept short supported Markdown output without unnecessary regeneration.
- OS1's implementation stage fixed the fleet self-test contract to supply the installed configuration, avoiding a false missing-configuration failure.

## Real UI-to-install execution

The request was entered in the OS1 GUI, not injected as an artificial backend result. Session `07D2B8B3-F8E3-4313-B07E-49C435B37DE9` ran architecture, implementation and independent verification through Codex. All three stages were adopted. Activity record: `ba55abf4-49ee-42af-bf5b-20946b58055c.json` in the local governance-activity store.

OS1 then staged its release, committed and pushed the runtime changes, waited for its installation gate, installed build195 and restarted. The installer receipt records 9 PASS checks and sessions **120 → 120**. Installed bundle version independently reads **195**. Restarted app PID was **63498**. The actual OS1 window visibly displayed the successful self-install receipt after restart.

Local receipt: `~/.os1/recovery/self-update-build195-2026-09-20T204643Z/install-receipt.json`.
Outcome: `~/.os1/self-update/outcomes/d403e86d-7f3d-4186-8aad-13b744073256.json` (`success=true`, `reported=true`).
Started: 2026-09-20T20:46:43.381Z. Completed: 2026-09-20T20:48:24.333Z.
Screenshot retained privately: `~/.os1/policy-audit/quota-repair-20260920/build195-ui-receipt.png`.

## Test evidence

`products/os1-mac-runtime/QUOTA-FALLBACK-VERIFICATION.md` contains implementation and independent-verification evidence. Independent verification ran 15 fresh commands with exit 0, including build, context tests, runtime/fleet tests, telemetry isolation, stage policy and seven app self-test modes. Logs and hashes remain under `.build/independent-quota-20260920/`.

Suite counts are not a deduplicated total: quota 40; recovery 128; health 31; unified execution 82; task context 329; fleet 24; stage policy 8. Two existing non-blocking compiler warnings were recorded, not hidden.

## Remote policy alignment

Private adapter revision: `os1-rcc-v26-local-adapter-2026-09-20.31`.
Policy bundle SHA-256: `d839c7bd75f3c0e7d839a510c6213b7822a4aa02002f2c9e0e912eab36591449`.
Router deployed version: `35ff1d5c-3166-495b-8192-988672601195`.
Private policy deployed version: `2cb49d19-a80b-4a5f-8d98-892de2ea8da2`.
The tracked router bundle pointer is updated to match the already deployed policy.

Private source archive (not public source): `omar-private-archive/os1/private-policy-source/3cdae0ad377f74fcbb4fc0a65a35b8a94a42867bffbc2838a3f1acb6cba61713.tar.gz`.
Bytes: 330982. Upload/readback byte comparison passed. No credentials or private policy implementation are included in this repository note.

## Evidence boundaries

Synthetic quota/auth regressions are separate from live account evidence. A current CLI probe returned `loggedIn=false`; this does not reconstruct the owner's earlier login/quota state. No live authenticated-Claude quota exhaustion was induced. The real GUI run proves Codex execution and OS1 autonomous installation, not every possible provider-failure path.

The earlier build194 installation was operator-driven preparation; it is not counted as autonomous proof. Build195 is the autonomous result. No website deployment, Instagram automation or message send was performed for this acceptance test. Read-only maintenance reconciliation is not replay authorization for historical side effects.

## Recovery and method

Installer recovery snapshot is preserved alongside its receipt. Prior router deployment: `9a647083-a515-47e4-a88d-23bb796371cf`; prior private-policy deployment: `4a0f4882-d41f-42b7-bd27-6d279f9e183b`; prior policy bundle: `439efb7e4fedb1261680c7c72632daef7eb1fe5ec5e8d5546f27d0f861dabdeb`.

Inspected research: [ReAct](https://arxiv.org/abs/2210.03629) and [intrinsic self-correction limitations](https://arxiv.org/abs/2310.01798). Applied mechanisms were source/log observation, bounded intervention, deterministic regressions, independent fresh execution and visible downstream receipt. Research and model agreement are not execution proof.
