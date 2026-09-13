# Bounded drift-to-instruction feedback

## Objective

An OS1-detected answer drift must become a recorded, testable correction for subsequent executions, not just an apology. Scope: OS1's native Codex/Claude execution instructions and local feedback state. No vendor system-prompt replacement, model-weight update, permission escalation, raw private RCC corpus disclosure, or SCV production change.

## Evidence / five perspectives

- Completion: the runtime has typed task/scope, local output guards and a server adoption loop; diagnosed failures do not currently feed a reusable instruction layer.
- Context: full source and user text must never be promoted from a rejected answer into higher-priority instructions. Different workspace/source/contract scopes must not share learned state.
- Execution: Codex receives `developerInstructions`; Claude receives `--append-system-prompt` with stale snapshots disabled. Preserve native account availability and replay gates.
- Verification: the 130 recent local diagnostic records include 8 presentation, 6 source-contract and 2 objective-category failures; 81 lack a specific semantic cause. The latter cannot honestly produce a specific corrective rule. Native/server acceptance is not proof of general factual correctness.
- Resources: deterministic classification and a fixed reviewed correction vocabulary add no reflection-model calls; cap active instructions and storage. Existing attempt/token accounting remains authoritative.
- Privacy/UX: persist typed failures and fingerprints only, not prompts, answer text, tokens or private source. Corrections live in the instruction channel, never fabricated user bubbles.

## Architecture

Local typed drift guard → bounded private event ledger → reviewed correction candidate → trial on the same objective → existing local + persisted-native + server acceptance → active rule for the same scope → subsequent native instruction channels.

On repeated same-kind failures while a rule is applied, suspend that rule rather than accumulating contradictory instructions. Interrupted, quota-limited, permission-denied or delivery-unverified attempts cannot promote/suspend a rule. A model saying “I drifted” is not a typed verifier event.

The rule vocabulary is developer-reviewed and tested. Runtime learning chooses applicable rules, records candidate/trial/active/suspended state and versions the instruction projection. It does NOT invent arbitrary high-priority instructions from free-form text. Unknown semantic failures remain diagnostics, not fabricated policies. Active means recovered under the existing validator, not globally proven improvement.

Scope binds canonical workspace, source content hash (or no source), executor contract and workload (source answer, requested deliverable, workspace operation or general answer). The store is per operating-system user/device. Raw policy corpus intake from the previous request remains unactivated; this feature sends only bounded non-secret correction directives.

## Invariants / acceptance

1. A typed observed drift creates a candidate; apologies, raw injected instructions and unspecified remote rejection do not.
2. Trial is limited to the same objective digest. Pending candidates never affect unrelated requests.
3. Promotion requires the actual candidate to have been applied, no intervening steering, native persistence verified, local validation passed and server adoption passed.
4. Two further same-kind failures under an applied rule suspend it; network/permission failures do not count as quality evidence.
5. Source/workspace/contract/workload isolation; fixed reviewed rule text, byte cap, TTL, event deduplication, bounded journal and file lock.
6. Same user request preserved verbatim; no extra paid repair hidden under one ticket; no mutation replay authorization gained from learning.
7. Corrupt, oversized or symlinked state yields no learned instructions; the existing safe executor contract remains in force.
8. Receipts expose revision/state/counts, not raw policy or source. Deterministic tests plus actual native instruction-channel checks distinguish wiring from measured quality uplift.

## Alternatives / rollback

Rejected: append every failure/apology to a global prompt (untrusted instruction promotion, privacy leak, growing token cost); additional unconstrained reflection calls (no independent correctness evidence); changing private router weights from a UI message (no calibration evidence).

Rollback: keep existing base executor directives immutable. Set the scoped learning state disabled, or revert the build using the preserved local installer backup. Do not delete conversations or source snapshots. Rules expire and contract changes create a new scope.

## References and limits

[Reflexion](https://arxiv.org/abs/2303.11366) motivates feedback memory without changing weights; this feature uses typed verifier events and reviewed rules, not the paper's full verbal-reflection algorithm. [Chain-of-Verification](https://arxiv.org/abs/2309.11495) motivates separate validation instead of trusting candidate self-approval; current OS1 guards remain bounded checks, not universal truth evaluation. [Official Codex configuration](https://learn.chatgpt.com/docs/config-file/config-reference) documents additional developer instructions. Native field compatibility is also checked against the existing working runtime.

No Pareto or global drift-elimination claim is allowed without controlled baseline/candidate measurements of task completion, quality, tokens and latency.

## Build 105 verification (2026-09-12)

- Installed `0.9.48` / build `105`, with the same local signing identity. Both app and CLI contain arm64 and x86_64 slices. The development package passed unpacked-client scanning (22 files, zero findings); this is not an Apple-notarized distribution release.
- Full context, output, recovery, permissions, queue, steering, parallel, Fleet, research-source and hook regressions passed. The independent installed-build audit passed all 14 checks. Existing 63 conversations and their messages, pins, drafts and native bindings were preserved.
- Deterministic correction tests cover candidates, same-objective trials, all adoption gates, unrelated-scope exclusion, failed-application suspension, late concurrent results, TTL, bounded storage, duplicate events, corruption, symlinks, private permissions and old/new outbox decoding.
- Native protocol tests assert that corrections enter Codex `developerInstructions` and Claude `--append-system-prompt`, not user messages; assigned sandbox/approval authority is unchanged.
- Two isolated objectives used explicitly synthetic presentation failures, then real native executions: Codex `gpt-5.6-luna/low` and Claude `sonnet/medium` returned adopted, persisted answers and each promoted its exact applied correction once. There were **three governed attempts**, not two: Claude's first `fable/low` attempt was unverified and did not generate or promote a quality rule. Its usage is not inferred as zero. No additional reflection model is called by the feature.
- The first integration-audit script mistakenly selected the earliest application receipt. It was fixed to join the adopted result to its exact attempt ID. Verification resumed from preserved results without resubmitting either objective. Both delivery replays preserved native transcript bytes and did not double-count promotion.
- Synthetic ledgers were disabled and moved into private verification evidence; production learning starts without synthetic rules. Historical free-form diagnostics are not automatically backfilled as semantic truth.

Private installation rollback: `~/.os1/recovery/build105-drift-feedback-20260912`. Do not restore its session snapshot over newer conversations; it is evidence, not authorization to discard user work.

## Operation

The feature is automatic for future typed validator events. It stores no arbitrary generated rule text and adds no separate learning-model call. Each projection contains at most three reviewed rules / 2,048 UTF-8 bytes, with a 30-day eligibility lifetime, at most 128 recent events per scope and 256 scopes per device. At capacity or when state is unreadable, OS1 retains the base executor instructions and records a diagnostic; it does not broaden access or silently delete user state.

Read-only status: `os1 drift-policy-status`. Explicit rollback of learned guidance for one listed exact scope: `os1 drift-policy-disable <scope-id>`. `os1 drift-policy-enable <scope-id>` re-enables that scope but never reactivates suspended rules. Rules and source/objective/output fingerprints live in `~/Library/Application Support/OS-1/drift-policy`; no credentials, source corpus, failed answer text or hidden reasoning are stored there.

Source tests: `swift run --package-path products/os1-mac-runtime OS1ContextTests --drift-only`. `os1 self-test` also checks both native instruction channels without model calls. The opt-in `scripts/verify-drift-feedback.mjs` runs two isolated objectives under the normal signed router. `--resume-verification` audits saved results without repeating paid work. These are wiring/recovery checks, not a controlled quality benchmark.
