# OS-1 completion-first routing repair

## Objective and boundary

Repair the active OS-1 model/effort selection while preserving working local
execution, source continuity, independent verification, session state and focus
ownership. No SCV production, billing, authentication, permissions or Fleet
changes. Codex/Claude remain background executors; only an explicit user action
may reveal them. Completion means the named acceptance suite passes, not a
universal claim about every future task or a learned model-success probability.

## Observed divergence (before changes)

- Installed app: 0.9.19/64. Active private policy: v19,
  `6c2a3d6b6d6eb5cebde62f8570e2fa9d33fdbd796db354f23639fac5566144d0`.
- “Explain cache invalidation in two short sentences.” selects Fable/low;
  appending “Do not deploy or modify files.” escalates to Opus/xhigh.
- Supported Codex reasoning levels are collapsed to one choice per tier,
  excluding some previously successful high-effort tuples from comparison.
- Current live Codex catalog includes gpt-6-astra (six reasoning levels), but
  the installed execution-profile allowlist omits all six. This is availability
  drift, not evidence that Astra should execute every request.
- Completion feedback already counts failed-attempt tokens, but recorded
  duration does not break ties between equally costly completed paths.
- Installed replay exposed a further context boundary: identical `pwd` prompts
  in different working directories reused a prior completion ledger because the
  working directory was absent from the input digest. Bind the canonical working
  directory locally; preserve historical ledgers but do not reuse them across
  workspaces. A workspace is execution context even when not written in prose.

## Architecture and alternatives

Original objective/source digest -> constrained difficulty projection -> RCC
source-locked floor -> executable model/effort candidates -> current-run failure
exclusion -> exact-context adopted candidates -> full-path token cost -> measured
full-path latency tie-break -> signed ticket -> existing execution/verifier.

1. Remove only whole, unambiguous standalone prohibition clauses from the
   *difficulty view*. Preserve the original prompt, objective hash, backend
   input, provider pin, permission constraints and verification request. Keep
   conditional, quoted, security-review and mixed positive clauses intact.
   Broad negation removal and lowering every difficult route are rejected.
2. Enumerate every supported Codex effort at/above the existing source floor.
   Keep source-policy order for unseen tuples; do not perform paid exploration
   or represent fixture observations as empirical production outcomes.
3. Add the six actually advertised Astra tuples to the signed execution
   allowlist on both client and private policy. The dynamic catalog continues
   to exclude unavailable/retired models. No arbitrary model identifiers.
4. Include all failed attempts in completed-path duration, as with tokens.
   Use latency only when comparable complete token costs tie. Unknown or
   truncated observations are not zero; no fabricated dollar-cost estimate.
5. Retain the exact v19 adapter for in-flight tickets. Upload a new immutable
   bundle, verify its hash, then activate the new pointer. Preserve old bundle
   and local signed app as rollback; never rewrite current user conversations.
6. Hash canonical workspace identity into completion input scope. Paths do not
   leave the device as feedback metadata. A new scope is not deletion of prior
   usage, and does not alter result replay, conversation IDs or source hashes.

## Five-view acceptance (non-compensating)

| View | Acceptance |
|---|---|
| Intent/completion | Original exact read-only command succeeds once; simple explanation does not escalate solely because deployment is prohibited; genuine high-risk tasks retain their floor. |
| Source/context | Prompt and source hashes unchanged; different objectives cannot contribute feedback; prior native records and source continuity remain valid. |
| Execution/capability | Every advertised executable Codex tuple can enter the eligible set at a compatible floor; pins, exhausted capacity and supported efforts remain hard constraints. |
| Output/verification | Existing exact-output, refusal, native-record and signed-artifact negative controls still reject invalid results; partial output is not adoption. |
| Tokens/latency | Failed paths count fully; known successful eligible paths beat unknown candidates; equal-token paths use known total latency; missing usage stays unknown. |
| Security/UX | Private policy absent from installer; no credential copying, permission broadening, backend activation, always-on-top or duplicate provider calls. |

## Evidence and implementation rationale

- OpenAI [model selection](https://developers.openai.com/api/docs/guides/model-selection):
  establish accuracy acceptance, then evaluate cost and latency. Applied as hard
  completion gates before observed resource comparison, not lowest initial cost.
- [Codex App Server](https://learn.chatgpt.com/docs/app-server): model/list supplies
  available models and supportedReasoningEfforts. Applied as executable catalog
  coverage, not a static three-model universe.
- [RouteLLM](https://arxiv.org/abs/2406.18665): quality/cost routing requires
  preference evidence and evaluation. This patch is a deterministic adapter
  repair; it does not claim to implement or train RouteLLM.

## Verification and rollback plan

### Additional installed divergence: readiness continuation

The exact historical Instagram recovery-readiness question took four Claude
attempts (Fable/low, Sonnet/medium, Opus/xhigh, Opus/max), 243,559 ms overall.
The first candidate printed fictitious Bash invocation markup. The second was
rejected merely for saying current automatic backups had not been verified
“in this session”; the same broad substring also rejected the third answer.
The latter additionally proposed more local inspection despite a snapshot-only
task. The source hash and 40 user sessions remained unchanged.

Minimal repair: preserve the task's source-integrity/claim-boundary audit intent
in the public routing projection instead of reducing it to a generic explanation.
The unchanged private RCC policy selects the model and effort. Explicitly bind
snapshot-only assessment to the available evidence and disallow invented tool
invocations/fresh inspection claims. Replace the `세션에서` substring gate with
bounded backend-redirection detection; honest uncertainty must remain valid.
Retain source relevance, provenance, native persistence, and actual action
refusal gates. This is not authorization to inspect/restore Instagram production.

Acceptance: exact-source replay must adopt on sequence 1, with no new retrieval,
no tool invocation, no conversation mutation and a useful evidence-bounded plan.
Offline paired controls must accept honest uncertainty while rejecting explicit
backend redirection and fabricated invocation markup. Preserve the full failed
four-attempt usage ledger; do not rewrite it as a successful first attempt.

The first installed repair adopted Sonnet/medium in one attempt (31,226 ms),
but manual output review found missing restore-drill and non-code recovery
prerequisites. Do not treat lower latency as compensation for incomplete scope.
Add explicit necessary coverage checks for an isolated restore test, service
configuration/runtime data and per-device authentication/secrets. These checks
are necessary, not a semantic proof. Update the executor assessment contract and
feedback validation revision; preserve old evidence and repeat the exact case.

Build 67 exposed two verifier false negatives: “새 기기 … 드라이런” was a real
restore-test proposal but failed the narrow spelling matcher, and a legacy
generic source had query filler (`나는`, `지금`, `작업해야`, `되거든`) recorded as
content anchors. A relevant response was rejected for not repeating those words.
Broaden only the restore-test lexical equivalence, discard query filler and
recognize Instagram/automation spelling equivalents. For readiness assessments
only, a repository identity from the verified snapshot is valid provenance;
ordinary research explanations still require their content anchors and claim
limits. Add paired wrong-repository/unrelated-objective negative controls and
test the recorded failed outputs before another live call. Do not delete the
failed model usage or mark the aborted/rejected run as successful.

First reproduce defects with the preserved v19 module. Run deterministic paired
positive/negative language controls, every supported effort, failure/pin/quota,
cross-objective, source-lock and prior-adapter tests. Then run private wrapper
and gateway tests, route-only deployed controls, installed native model calls,
duplicate-execution/result-recovery controls and passive focus observation.
Record actual timing/usage and artifacts. Restore the previous immutable bundle
pointer and signed 0.9.19 app if any hard installed acceptance gate fails.

Private pre-change backup: `/tmp/os1-routing-completion.VYUWag` (mode 0700).
