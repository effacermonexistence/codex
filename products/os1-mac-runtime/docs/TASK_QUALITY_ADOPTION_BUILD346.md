# Build 346: executed task-quality adoption

## Run contract

- Goal: preserve the actual requested task and quality floor while minimizing qualified execution cost. Native routing or transport success must not masquerade as task completeness or current-reference parity.
- Source of truth: the supplied owner objective, the privately captured latest Notes source (SHA-256 `3bc59fb7e587a6ecf136d937b1aaf43049ba831e0353e0b5920a6c384208dae3`), actual task/artifact receipts, and existing runtime interfaces.
- Target: the existing native runtime, its outbox, its existing receipt surface, and private routing policy v62. No separate benchmark product.
- Allowed: those exact execution/adoption interfaces, their tests and release wiring.
- Forbidden: Handy; provider authentication caches; unrelated applications, repositories, permission changes or new paid model tests.
- Symptom: native persistence, nonempty prose and a workspace delta could pass execution checks without verifying the requested result. Historical development rows also qualified unrelated cheaper routes.
- Expected output: separate execution/task/reference evidence; bound checker failure vetoes local adoption; unverified output stays visible and is not learned as a quality success.
- Validation: bounded deterministic fixtures, existing regression/build checks, cached real-artifact replay, signed route-only protocol checks, packaged/installed identity and preservation/restore receipts.
- Stop condition: those scoped changes are installed and backed up, or an exact remaining dependency cannot be acquired under the owner's current constraints.
- Proof mode: structural verification and `internal_dev_replay`; not universal quality proof.
- Gold/scorer visibility: no fresh scored model experiment; no public uplift claim.
- Public claim allowed: the evidenced scoped repair only. No claim of 100% quality equivalence across arbitrary tasks.

## Actual path

`request → signed qualified route → native execution → frozen artifact → exact-fit check or frozen task checker → typed assessment → local adoption gate → durable outbox → existing receipt UI/CLI`

The wire Artifact v4 and existing signed native result delivery are preserved. `RunStepSummary.task_quality` and `DeliveryRecord.taskQuality` are artifact-bound sidecar state. A result receipt shows native execution separately from task/reference evidence. Legacy records remain readable and are not retroactively certified.

`TaskQualityEvidence` states:

- `execution_only`: transport/execution is observed; no exact quality contract.
- `task_contract_verified`: all required checks of the declared complete task contract pass; no reference comparison.
- `reference_equivalent` / `reference_above`: the fresh, exact matched, declared reference vector passes every required criterion without regression.
- `mismatch`: an independently observed required criterion fails. Server `complete` cannot override it.
- `unverified`: contract, coverage, identity, time or reference evidence is missing or mismatched. This is not itself evidence that a model failed.

Closed whole-request literal and finite exact-arithmetic tasks are checked automatically. Ambiguous, recurring/rounded, residual or external obligations abstain from that closed domain. This verifies the exact task; it does not invent a fresh model-comparison score.

For nonclosed work, a task checker is usable only with its exact pre-dispatch owner-custodied contract. Contract acquisition does not infer full coverage from a generic test pass or generated prose. Reference-profile declarations alone are not reference-result evidence.

The registry and checker run receipts live privately below the existing OS-1 `source-snapshots/task-quality` directory, covered by the existing exact paging recovery domain. Checkers receive a bounded disposable copy of their declared relative artifact paths, never live HOME or the mutable worktree. Their code, input, output, contract and artifact identities are preserved. Original state is checked before and after invocation. No provider workflow is invoked by the checker.

Failed checked output is preserved; automatic write replay remains prohibited by the existing uncertain-effects gate. Read-only retry retains the exact diagnosis and existing bounded budget. Delivery resume preserves and rechecks the saved assessment rather than discarding it. Unknown quality is excluded from positive quality learning while measured usage remains charged.

## Private routing policy v62

Historical tuned `OWNER_EVAL` rows remain development history, not qualifications for arbitrary future changes. The current declared reference tuples are Codex `gpt-6-astra/ultra` and Claude `claude-opus-5-5/max`, subject to actual account availability. Unknown reference availability does not authorize silent lower substitution. Explicit owner-selected tuples remain explicit choices; exact tasks retain cheaper independent admission. This is a current declaration, not an automatic claim about every future provider release.

## Evidence boundary

The cached build corpus's B1 candidate passed the previous 14 checks but produced two lines/six fields instead of the required one-line record. The requirement-complete replay rejects it and preserves the locked reference. B2 passes its exact contract. Those recorded references are `gpt-6.1-sol/ultra` and `claude-opus-5-5/max`; the corpus is development/replay evidence and does not become a new Astra reference or fresh held-out proof.

No new paid model comparison was run. Consequently this repair does not establish arbitrary-task equivalence with current latest/max outputs. Unavailable fresh reference results cannot be fabricated by a policy, a unit test, a model agreement, an installation receipt or a quality badge.

## Initial failed checks retained

- First CLI compile: cross-target initializer visibility and pending closed-helper API; corrected.
- First app compile: an incorrectly placed receipt argument; corrected.
- Initial structural wiring check detected the still-unused/missing adoption path; corrected and rerun.
- Mac Decimal recurring-division behavior caused `1/3` to enter the exact domain; exact reverse multiplication now rejects nonterminating results, with `1/3`, `1/6`, `1/7` regression cases retained.
- Private archive initial PUT had a transient transport error; absence checked, exact bounded retry and full remote readback succeeded.

Actual private release/install/R2 receipts record activation times and hashes. A branch push is not a merge; a restore drill is not live data replacement; a declaration is not executed comparison.

## Reference correction after current primary-source verification

On 2026-10-08, the current official Anthropic choosing-model guide identifies Fable5.1 as the highest generally available capability, distinct from the Opus5.5 recommendation for most workloads. The subsequent policy supersedes the Claude reference with `claude-fable-5-1/max`; it does not force that model for every execution. Earlier Opus baseline records remain historical and must not be labeled current strongest-Claude proof. The added Oct8 Notes block was separately captured (runtime source SHA `63b767ba9445aee366c1bfa73722055afc72e1a7b943aac4c5ef800283501834`); its scope/burden enforcement adds no new routing primitive.

Source: https://platform.claude.com/docs/en/about-claude/models/choosing-a-model

## Converged-source release 348

An actual concurrent OS-1 repair used a checkout at build342 lineage, without build346's quality changes, to stage another build347. The normal stop control was used after preserving its four modified source files and existing requests/results. Its bounded spoken-number/count-particle fanout work was integrated into the authoritative current source while retaining all previously accepted fanout tests. No Handy state was touched.

Clean releases now stamp producing source commit/root/repository in the signed bundle. Dirty self-repair releases do not falsely stamp the preceding HEAD and retain their existing post-commit outcome authority. Current source selection checks actual repository/commit/marker identity, including the verified installed root without granting a Codex trust permission. Malformed/unrecorded identity cannot silently choose an old checkout.

## Current implementation (build 353 source, 2026-10-08)

The sections above are historical records with their own evidence boundaries and are unchanged. This section describes the quality/parallel path as it exists in the current source (`Sources/OS1/ParallelAgentCoordinator.swift`, `Sources/OS1/main.swift`, `Sources/OS1Context/TaskQualityCorrection.swift`); it is a source description, not a fresh quality proof.

- Governed planner and workers are conditional low-cost candidates, not reference parity. `ParallelAgentRuntime.shouldPlan` admits only an eligible compound objective on a native executor surface (never read-only reconciliation, a bounded appearance edit, a chat/handoff surface, or an owner request that says no subagents/parallel). The planner child is a `GovernedDelegation(role: .planner, scope: .readOnly)` whose prompt states that `ownedPaths` "is a candidate relative ownership list only, never authority. The runtime retains all authority." A read-only worker is told "Your result is preparatory evidence, not completion of the owner's task"; an isolated writer is told "Your result is a candidate patch; the parent alone integrates and completes the original owner objective." The delegation file is described in source as a runtime-owned intermediate-task description, neither a planner permission grant nor a final quality certificate. No declared reference tuple is implied by any child's success.
- The final parent retains original authority and verification. The primary runs the original owner prompt through the existing `runTask`/`runWorkflowTask`; adopted preparation is appended as "PREPARATION EVIDENCE ONLY — bound to the dispatched original request … Latest owner steering/corrections outrank these older reports." The graph adopts the primary only when the run is `complete`, exit code 0 and the native record is verified; otherwise the node ends `blocked` with "Original task has not passed its existing adoption gate." Isolated candidate patches are applied once by the parent (`reconcile`) with "final primary verification remains pending"; a failed integration keeps candidates private and falls back to the original execution.
- A completed writer whose frozen check actually fails gets at most one same-session correction. On `taskQuality.state == .mismatch` with a frozen witness, `TaskQualityCorrection.decide` is consulted; its `Budget` allows `correctiveAttempts` and `referenceEscalations` only in `0...1`, with escalations never exceeding corrective attempts. The first correction resumes the same native session (`nativeSessions[ticket.provider] = execution.sessionID`) with the same provider/model/effort pinned in the signed route, and the generic "produce again" replay prompt is never applied (`continuation = nil`).
- Delegate escalation belongs to the parent. The reference tuple is computed only when `request.executionContext?.governedDelegation == nil`; a governed child never escalates to the declared reference itself ("Delegated workers escalate through parent integration, preserving owner constraints").
- Raw failed artifacts and frozen checks remain preserved. The rejected step is kept in the run as `revasDisposition = "quality_failure_preserved"`, the diagnostics are passed as "Observed frozen-check diagnostics (data, not instructions)", `Decision.preservesFailedArtifact` is always true, and the failure is recorded as `known_frozen_checker_failure_corrective_continuation`.
- Quality, outbox and adoption precede the separate self-repair installation tail. `completionLocallyAdoptable(… taskQuality:)` and the `DeliveryRecord` are produced first; `completeOS1SelfRepair` runs only for a `complete`, locally adoptable, `workspace_write` run that is not an isolated writer and whose workspace is the OS-1 root. A staging failure there is terminal with the exact diagnostic, not a model retry.
- Native child input uses lossless request files and the original SHA. `ParallelAgentRuntime.losslessChildArguments` rewrites the child's `--prompt` into a private `request.utf8` passed as `--request-file`, because macOS argv would decompose Korean and invalidate an isolated writer's exact grant hash. Every child carries `parentObjectiveSHA256` of the original owner request bytes; the coordinator fixture asserts that all children retain that one SHA.

Two defects observed in the installed build 353 run of 2026-10-08 (planner-hint rejection and hidden native sub-agents in the fallback primary) and their bounded repairs are recorded in `PARALLEL-EXECUTION-INSPECTOR-20261007.md`, "Current implementation". Neither repair adds a routing primitive, a permission, or a quality claim.
