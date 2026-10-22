# Per-task hard-zero model generation

Optional existing request budget field:

```json
"forbid_model_generation": true
```

It is a strict boolean, not a token estimate, quota setting, numeric dispatch
counter or zero-cost surrogate. Missing/false preserve legacy behavior. Present
null, numbers and strings reject. Existing `max_native_dispatches` keeps its
1..64/null semantics; it is not a local-model cap. No local-usage count is
invented and no observed or unknown past usage is reset.

The ordinary CLI carries the policy through the existing single Core request:

```sh
os1 run --workspace /absolute/workspace --prompt "hello" --forbid-model-generation
```

The flag has no value; repeated flags or extra value arguments reject. It is
incompatible with legacy parallel-child/fanout execution and rejects before
child preparation. No environment/global config, new controller, vendor API,
private IPC or permission change is involved. Other callers of
`runOpenClawRCCTask` default false; the CLI's absent flag is encoded as **nil**,
so the optional wire key remains omitted and old request fingerprints do not
change. Explicit raw false remains a distinct serialized input. A changed budget
on an existing task ID remains an idempotency conflict, never a retrofit of a
running task.

## Exact allowed deterministic scope

Hard0 allows only the **existing** pure-Core fresh `hello` acknowledgement and
exact arithmetic paths. It does not add another acknowledgement controller or
claim that every natural-language liveness question is deterministic.

Every other hard0 request—including the ordinary Korean acknowledgement
question—holds with `model_generation_forbidden` **before** the opaque intent
resolver, catalog or planner callback. Thus a generic injected resolver cannot
spend a local completion merely because it was told to obey a boolean. Default
Korean acknowledgement behavior with absent/false policy is unchanged.

Metadata-only native commands/compilers are not globally prohibited. The
exported production intent resolver may run its deterministic probe but rejects
`needs_model` before `complete()` when directly given hard0. Core's hard0 owner
path deliberately does not call even that opaque resolver, avoiding a new
trusted-resolver/permit interface for optional coverage.

The same persisted original budget guards adaptive shadow/covered-live planner
invocation, external plan/repair, all native **and local** executor admission,
handback/reference/quality continuations, quality decision and opaque family/
parent verification hooks. Derived tasks cannot weaken the original policy.
Recovery preserves the flag and all existing results, receipts, attempts and
unknown usage. A prior unknown/observed attempt is not reclassified as zero.

This is a per-submission **Core-owned** execution policy. It is not a machine-
wide ban, a guarantee about unrelated concurrent tasks, or a policy retrofitted
onto standalone native adapter tickets. Ordinary tasks may continue concurrently.
Metadata emitters and the host implementation remain trusted code, not a sandbox
against a malicious process independently calling a provider.

## Verification boundary

The new source/fake suite spies on every generation-capable hook, proves exact
hello/math callback counts zero, proves unknown/Korean/local/native requests
hold, and exercises repair/continuation/planner/verifier/restart/idempotency and
concurrent normal behavior. Denied execution does not fabricate a model receipt
or select a native configuration. Existing deterministic output retains its
truthful `model:none` Core identity.

The wire test Swift-compiles the actual production `Budget` source and checks
absent/false/true encoding plus malformed rejection. It inspects actual CLI
flag/carry/child-rejection source and Swift-parses main.swift; that is not a full
CLI typecheck or installed execution. Root-owned build, exact source pins,
installation and actual hard0 CLI observation are separate later gates. Installed
422/a454 is not changed by this source-only branch.

Relevant abstracts actually inspected during this repair sequence were
[ReAct](https://arxiv.org/abs/2210.03629) and
[intrinsic self-correction limitations](https://arxiv.org/abs/2310.01798).
They motivate source/feedback anchoring, not a model-call or efficacy claim.
Execution evidence is the actual callback guards, wire roundtrips and fixtures.
