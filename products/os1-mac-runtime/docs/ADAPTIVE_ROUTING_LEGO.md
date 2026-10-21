# Adaptive routing LEGO: prompt views and evidence boundaries

**Status: source implementation and offline fixtures; default OFF, shadow-only.**
This document is not a release/install receipt, live routing activation,
calibration artifact, quality-parity result or quota-savings measurement.
`covered_live` cannot be activated by a configuration flag or hash-shaped JSON.
P6–P9 native measurement, learned calibration, fresh/held-out evaluation and
bounded live-family promotion are **not done by this change**.

The objective remains quality/completeness under a frozen reference policy,
then minimum supported total resources. Neither every node on the strongest
model nor arbitrary cheap-model predictions establish that objective.

## One owner, distinct views

```text
OS-1 original request + typed host context/material references
  |
  v
EXISTING OpenClaw RCC Core task / durable lifecycle / permissions
  |
  +-- OFF: existing host plan; no new proposal/predictor call
  |
  +-- SHADOW: bounded classifier/planner view
  |      exact current request + exact objective
  |      owner routing/policy projection + public local kernel
  |      host requirement/material/check/candidate metadata
  |      -> untrusted proposal -> structural/fresh-host validation
  |      -> observation ONLY, not an executable plan or quality certificate
  |
  +-- optional synchronous host artifact callback -> joint selector SHADOW
  |      no artifact = unmeasured; no invented confidence
  |      exact tuples -> current hard facts -> quality threshold -> resources
  |      proposed tuple does NOT replace the admitted execution tuple
  |
  v
EXISTING host plan / exact candidate / pool and workspace admission
  -> existing ticket and native adapter
  -> executor view: assigned task + original owner objective/context/materials
  -> actual result + native/checker/usage observations
  -> existing Core adoption / existing routing ledger
```

There is no second scheduler, task queue, retry owner, final evaluator server,
account migration or hosted API fallback in these modules. A shadow proposal
does not create fake parallel worker cards or authorize its own candidate.

## Classifier metadata is not executor source data

`createPlannerHostProjection` preserves the exact request/objective and maps
material references to short host aliases. Its initial material metadata is
`read_status: not_read`, `required: unknown`, `authority_scope: task_data`.
Those are not source-read receipts. The bounded local model sees aliases,
labels and requirements—not full source bodies, raw filesystem locators,
the host transcript dump or the entire private owner engine. An explicitly
supplied `unknown` remains unknown; the model cannot promote it into approval.

This reduction applies **only to the classifier view**. It must not delete
material references or original context from the executor ticket. The ordinary
host plan still preserves original instruction bytes, `original_request`,
`original_objective`, `host_context` and selected `context_refs`. The existing
native loader separately checks the selected typed source references, loads
the immutable source snapshots, enforces its byte limit and passes source DATA
to `providerPrompt` before dispatch. A budget failure is not permission to
truncate original material and claim it was delivered.

The prompt-view fixture verifies helper request bytes and the real Core's
ticket preservation with a fake executor. It does **not** execute that native
source loader, prove provider inclusion, or establish semantic fidelity.
**Actual native instruction/material inclusion remains unknown in this phase.**

## Source → rule → prompt/gate mapping

Paths below are relative to `products/os1-mac-runtime` for a portable checkout.

| Source / authority | Preserved rule | Current mapping | Evidence boundary |
|---|---|---|---|
| Original owner request and current host state | Object, criterion, conditions, negation, time and unknown state remain the floor | `adaptive-plan-host.mjs::createPlannerHostProjection`; six-field task/request/source/policy/catalog/nonce wrapper; fresh recheck in `compileFreshPlannerProposal` | Structural mapping is not complete semantic coverage |
| Device-owner original policy digest | Do not replace or distribute the private original with a summary | `OwnerPolicy.swift::OwnerPolicySnapshot.verifyOriginal/originalText` and content-addressed `sourceSHA256`; the private source stays device-owned | A hash pointer is not full-engine delivery or behavioral compliance |
| Owner routing + policy projection | Relevant bounded governance is attached before local planning | `local-plan-planner.mjs::projectInput` validates projection bytes/hash against the host binding, then prepends them to `systemPrompt` | The projection is explicitly not the complete original engine |
| Public local planner kernel | Untrusted task DATA, no tools/task answer/hidden reasoning, no authority fields; bounded graph hints only | `LOCAL_PLAN_KERNEL`, JSON response schema, input/output/node/revision limits and `reasoning: off`; plugin `before_tool_call` block | A prompt or hook declaration alone is not live model-compliance evidence |
| Current host catalog and quality policy | Exact surface/transport/account/model/effort/tools/scope/pool/config, not name/tier confidence | `joint-route-selector.mjs`; separate immutable quality-reference descriptor and prebound live fallback; calibration/forecast/OOD/coverage/freshness checks | Host must actually validate evidence artifacts; synthetic .99 is not measured parity |
| Current Core context and policy | Source/instruction bindings cannot be repaired merely by recomputing supplied hashes | `rcc-runtime.mjs::_jointRouteShadow` independently matches `source_snapshot_sha256` to `task.source_fingerprint` and `instructions_sha256` to `task.policy_sha256` | Here source snapshot means the **host-context fingerprint**, not a source-body hash; instruction hash means owner projection, not every native prompt byte |
| Existing executor contract and actual permissions | Model instructions cannot grant filesystem/backend authority | `Sources/OS1/main.swift::executorInstructions`, `claudeExecutorInstructions`, `rccNativeAdapter`; source/account/config/isolation checks before native dispatch | These are existing code paths, not new successful native executions |
| Executor source material | Original selected source bytes remain DATA | `RCCNativeSourceDelivery.prepare` → `providerPrompt` → `execute`; selected subset and bounded immutable loader | Prepared-before-dispatch receipt is not provider inclusion or correct use |
| Native result, checker and adoption evidence | Execution-only is not correctness or reference parity | Existing `_validateExecution`/adoption plus `routing-outcome.mjs`; scoped complete checker and actual tuple required for quality labels | Critic agreement, repeated answers and receipt existence do not certify quality |
| Actual resource observations | Unknown is not zero; retries/integration/children count once | `resource-usage.mjs` and typed outcome projection; native cache/reasoning subsets, explicit parent/child accounting basis | Tokens do not establish subscription quota or dollars |

### Separate identities, not one “RCC hash”

- **Original policy:** per-device `OwnerPolicySnapshot.sourceSHA256`. Do not
  copy its private bytes into this public documentation or fixture.
- **Routing/projection:** SHA-256 of the actual supplied routing/projection
  text. Local planning validates this binding; existing native call-sites
  carry the owner projection through their supported instruction channels.
- **Public planner kernel:** `rcc-local-plan-kernel-v1`, 1,422 UTF-8 bytes;
  SHA-256 `088268245141b9c8948da73320308d08345312938401253631af1b5fc5b26c28`.
  The helper reports this identity separately from both owner hashes.
- **Host-context fingerprint:** current task context binding. The shadow
  observation labels its basis
  `exact_core_host_context_fingerprint_not_source_body_hash`.
- **Original material:** immutable snapshot/reference hashes are a separate
  native-source custody and delivery concern. None of the above substitutes
  for their bytes or provider-side inclusion evidence.

The supplied design discussed a roughly 859 KB private engine. This change
neither embeds that engine everywhere nor asserts that a 1.4 KB kernel is
semantically equivalent to it. Kernel/projection/native harness changes must
be versioned and accounted for in any future calibration/evaluation contract.

## Existing native instruction channels, unchanged by prompt views

The native adapter checks original request/context fingerprints and verifies
the owner original before using the selected model/effort. Its source preload
and original executor ticket are not reconstructed from the classifier reply.
Claude receives the executor requirements through `--append-system-prompt`;
the user task remains separate DATA. Codex receives developer instructions,
or an already verified base-instructions projection without a second copy.
This is not a claim to replace either provider's platform system prompt.

Permission enforcement remains native host code. A model saying “read-only,”
“approved” or “verified” does not create an authorization. Successful prompt
construction is upstream of real dispatch, source inclusion, effect
verification and final adoption.

## Verification and what remains

The new `openclaw-rcc-adaptive-prompt-views.test.mjs` uses canned completions
and a temporary real Core with a fake executor. It checks exact objective,
policy/kernel identities, material alias isolation, unknown statuses,
tool-free/no-hidden-reasoning request shape, zero-call input-budget rejection,
and unchanged original executor ticket/context. It does not inspect private
owner-engine bytes or execute a provider.

The planner helper has a bounded host-requested revision API. The current
shadow Core invocation supplies attempt index 0; this does not claim an
automatic Core refinement loop or that a revision improves the result.

Related offline fixtures cover untrusted proposal compilation, exact tuple
selection, typed outcome/idempotency, plugin policy limits and advisory-only
joint shadow observations. Their synthetic data must not become production
training examples labelled as measured provider performance.

Before a **full-engine comparison** or live promotion:

1. Freeze a new owner-authorized run card, task/sample/source set, actual
   reference policy and native model/effort/harness/config/instruction hashes.
   Do not reopen old authority or select the higher-scoring provider per row.
2. Separate development, calibration and fresh/held-out samples; audit near
   duplicates and provenance. Choose the reference policy before evaluation.
3. Compare full-owner-environment reference and bounded-projection candidate
   with the same original tasks/materials/start state/permissions. Lock final
   artifacts before exposing gold, scorer or outcome labels.
4. Measure source-grounded semantic completeness and omissions as well as
   deterministic checks. Record false accepts, false rejects, failures,
   cancellation, OOD and unresolved results; a partial checker stays partial.
5. Count whole-task parent/child/planning/retry/integration resources without
   cumulative-usage double counting. Keep latency, tokens, native quota
   observations and cash charges separate. Extra-compute wins are not savings.
6. Promote only explicitly covered families under a versioned policy and
   existing native/adoption gates. Until then OFF/shadow preserves the current
   admitted execution route. P6–P9 are pending, not implied by offline passes.

## Research provenance, not product proof

Primary arXiv abstract/metadata pages were inspected for this mapping; no private
task data was sent in research requests. These works motivate mechanisms, not
an OS-1 performance claim:

- [ReAct](https://arxiv.org/abs/2210.03629) studies interleaving reasoning/actions
  with external observations. Here the operational graph and observations are
  explicit; the local classifier remains tool-free and does not expose private
  reasoning traces.
- [Large Language Models Cannot Self-Correct Reasoning Yet](https://arxiv.org/abs/2310.01798)
  reports limits of intrinsic correction without external feedback. Hence
  self-reported confidence/correction is not a checker or quality certificate.
- [Self-Refine](https://arxiv.org/abs/2303.17651) studies iterative feedback and
  refinement. The helper permits a bounded, host-controlled revision and
  preserves raw failures; current shadow invocation does not assume or
  demonstrate a refinement win.

The joint selector separately credits Microsoft BEST-Route Algorithm 1 and
retains its MIT notice. No hosted weights, Azure router, API entitlement or
published research benchmark result is imported as OS-1 proof.
