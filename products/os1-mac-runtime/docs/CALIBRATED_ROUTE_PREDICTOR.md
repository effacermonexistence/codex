# Conditional calibrated selector projection

`Resources/openclaw-os1-bridge/calibrated-route-predictor.mjs` connects an
independently verified, host-loaded P7/P8 bundle to the **existing** advisory
joint selector. It does not fit data, certify an answer, grant native authority,
change the selector's thresholds, or promote the development lookup format.

## Host API and the real default preparation path

- `createCalibratedRoutePredictor({evidence, prepare})` returns a branded,
  synchronous callable. `prepare` is an optional host-constructor function,
  never task/model JSON. If omitted, preparation selects a unique complete
  pre-outcome record from the loader's protected `host_records` inventory.
- `prepareCalibratedRouteRequest(evidence, context)` exposes the same default
  record selection. Missing/ambiguous/changed records return null. This is a
  conditional implementation, not a callback that always returns null.
- `isCalibratedRoutePredictor` and `isCalibratedRouteInference` check in-process
  identity. Serialized hashes or copied status fields cannot reconstruct them.

The invocation context is exactly
`{task,node,baseline_plan,catalog,baseline_candidate,reference_candidate,now_ms}`.
`node` is the original R0 node, including at predispatch recheck. Core separately
enforces current first-turn, full-contract Auto admission and its fake-executor
fixture boundary. Only one source-free original read-only request is supported.

The protected record supplies exactly
`{selector_input,current_bindings,features,original_r0,task_boundary}`. Its
source-bound capture time precedes invocation; task/request/source/plan, catalog
tuples, R0/frontier roles, constraints and native harnesses are checked again.
This version is restricted to exact prepared task/node identities, including
the original plan hash. It is not a general producer of evidence for future
GUI-generated UUIDs. An unprepared new UUID follows R0; this module does not
rebind a plan hash without an independently supported semantic-plan witness.
No context capacity, token count, native instruction, availability or quota
observation is inferred from a model name. Every current selector hard gate
still applies. An optional custom preparer cannot replace the protected record.

## Statistical and resource boundaries

The point estimate is the frozen P7 training match MLE. The lower bound is
`min(training_match_MLE, assessed_calibration_match_lower_bound)`, under the
explicit registered projection rule. This is a conservative interface mapping,
not a new calibration transform or an individually guaranteed probability.
Exact-stratum stationarity, P8/freshness, source/rights/split/label review and
root promotion are loader prerequisites. Both the match and task-success
assessments must meet the actual preregistered P7 policy, including Brier/bias
and accepted_B=0. Both-wrong matching never becomes task success.

All ten existing selector resource components must come from the independently
source-verified disjoint partitions. The predictor never splits a scalar native
total or fills an unknown component with zero. Means retain actual support
counts and their partition artifact hash. Inclusive parent/child/cache/reasoning
accounting is not added again. Scope remains one native attempt including native
children plus measured disjoint host overheads; no host retry or broader task
cost claim is introduced. Tokens are not quota credits, cash or wall time.

The independent frontier remains the selector's frozen comparison/fallback
descriptor. The **actual original R0 remains Core's fallback outside that
selector**. Their roles are not interchangeable. Identical actual configurations
may use the same qualified resource observation only after both role bindings
pass. A third R0 configuration needs its own qualified cell and partition.
A proposal must be strictly cheaper than both the source-bound current R0 and
the frontier. Preserve/hold/error never switches execution to the frontier.

The result is `qualified` only for actual evidence, or
`qualified_synthetic_fixture` for synthetic fixtures. Both include nonnull
selector input/selection and a task/plan/feature/reference/pool/resource-bound
receipt. Both always keep execution/live-route authorization and quality
certification false. Synthetic status is not rewritten into actual status;
production Core rejects it. All missing evidence preserves original R0.

## Research and test scope

The actual primary sources inspected were
[BEST-Route section4.2/Algorithm1](https://arxiv.org/html/2506.22716v1) for
quality-then-resource selection and
[Loper/Regier section1 equation1](https://arxiv.org/html/2503.17594v1) for the
bounded-sum inequality used by the existing P7 assessment. This module does not
change that bound or claim either paper's results as OS-1 results.

The synthetic fixture exercises real arithmetic, protected-record preparation,
brand checks and the unchanged selector. It is software verification, not an
actual fit, a measured saving, a public proof row or production promotion.
No model/provider calls, source uploads, installation or live execution are
required. Current real artifacts may remain missing while this branch is
fully executable on appropriately qualified inputs.
