# Unlimited OS-1 run admission — Claude integration handoff

Base: `231d79f902d316721c76b93d6a6dcdb4b6fd8996` (build329 local integration commit).
Branch: `os1/unlimited-run-slots`.
Scope: application admission and settings only. No app version change, stage/apply/install/restart, provider task, Handy operation or authentication-cache transfer.

## Changes

- OS1Settings' existing optional field now means nil=Unlimited, default nil; explicit limits1...64.
- Old/unversioned JSON12 migrates to nil; legacy1...11 remains finite. Settings encode `parallelRunLimitVersion=2` so a NEW explicitly chosen12 round-trips as12. This is a settings schema discriminator, not an app version bump.
- `RunAdmission.decide` is the single pure admission decision. An unlimited limit has no hidden4/12/64ceiling; finite limits apply only to slot-bearing active runs.
- `RunMemoryPressure.current` reads `kern.memorystatus_vm_pressure_level` directly with sysctl. XNU translates internal state to dispatch flags normal1/warning2/critical4; unknown/unavailable measurement stays unknown and does not create a phantom permanent hold.
- warning/critical queues NEW runs with an explicit memory reason. Already admitted work is never cancelled by this policy.
- Active `.waitingForSource` tasks consume zero global slots while retaining their conversation ownership. A narrow activeRuns waiting-count edge wakes admission without changing progress callbacks, attemptFeed, TurnWork or governance.
- The queue pump samples per iteration and passes the SAME admission snapshot into start, so removing a queue item does not race a second pressure sample. A rejected direct start parks its exact submission, with no payload loss.
- Optional `admissionDeferred` is queue custody for a start already requested by a caller. It only releases the matching original failed-request/read-only-readback hold; pause/edit/source/other failure gates stay in force. It is cleared from the in-flight copy and does not authorize another action or provider.
- Registered-source/backend recovery snapshot admission before spending their existing retry budget. Retry payload and attempt/feed logic are unchanged.
- Existing three-second maintenance resamples and resumes preserved work after pressure clears. Empty queues are not reserialized every tick.
- Settings picker has Unlimited plus1...64. Unlimited labels display `N running` / `실행 N개`, never a fake denominator. Finite-only slot wait positions and memory reasons remain separate, without hiding paused/source/restart/failure holds.

## Deliberate boundaries

The finite setting is a NEW-admission ceiling, not a kill mechanism. A source waiter already admitted can later resume, or the owner can lower a cap below the current run count; existing runs still finish. Same-conversation FIFO, source leases, self-update quiescence (which still counts all active/in-flight tasks), provider permissions and failure custody remain unchanged.

An existing owner-selected4 remains4 by the requested migration contract. The owner can choose Unlimited in Settings after Claude integrates the branch. Tests use explicit nil/fixed limits and injected normal/warning/critical pressure, not the real owner's settings or current host pressure.

## Files

- Sources/OS1Context/Localization.swift
- Sources/OS1Context/RunAdmission.swift
- Sources/OS1App/OS1App.swift (admission/settings/status + isolated fixtures only)
- Tests/OS1ContextTests/SourceContextTests.swift (test entries)
- Tests/OS1ContextTests/RunAdmissionFixture.swift
- Tests/OS1ContextTests/UnlimitedSlotSettingsFixture.swift
- scripts/test-run-admission-wiring.py

GovernanceMonitorView, NativePublicRunLog, TranscriptMarkdown, SourceConfinement, main.swift/full-access continuation and release/version/installation files are unchanged. The retained numeric maximumConcurrentSessions property is used only by existing explicitly finite fixtures; actual admission and public display use the optional value and pure decision.

## Actual final verification

- `swift build`: PASS.
- Full OS1ContextTests: PASS.
- Settings migration fixtures:38PASS.
- RunAdmission fixtures:117PASS (nil/1/4/64, normal/warning/critical/unknown, source-wait exclusion).
- Actual SessionStore unlimited/source-wait/pressure/race integration:18PASS per run; eight simultaneous synthetic starts.
- `os1 self-test`: enPASS, koPASS.
- `os1 fleet-self-test`:79PASS, existing public config via OS1_CONFIG.
- OS1App seven requested self-test kinds: allPASS; `--self-test-parallel` three final runsPASS.
- Source confinement wiring:55PASS (existing guards unchanged).
- Run admission wiring:20PASS.
- `node scripts/test-self-test-isolation.mjs`:21/21PASS with poisoned1/12/none owner settings and protected live journal/activity/failure/cancel files.
- Independent bounded source reviews: no remaining blocking admission defect found.
- Paid provider-model calls:0.

Live conversation/queue JSON was compared before/after these runs. Private state/digests/logs are not committed to the public repository. This branch is compiled/tested source, not an installed release; Claude owns subsequent integration and installation.

## Sources actually inspected

Apple XNU's sysctl conversion:
https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_memorystatus_notify.c#L1651-L1679
https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_memorystatus_notify.c#L1753-L1768

Local macOS SDK dispatch/source.h and Swift Dispatch MemoryPressureEvent raw values confirmed1/2/4. This is not a guessed free-memory percentage.

Bounded repair method used actual external feedback and deterministic fixtures, not generated self-critique:
https://arxiv.org/abs/2210.03629
https://arxiv.org/abs/2310.01798
