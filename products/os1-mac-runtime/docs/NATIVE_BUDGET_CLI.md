# Ordinary-run native dispatch and worker caps

`os1 run --max-native-dispatches N --max-parallel M` carries existing Core budget
fields, not a new scheduler. N is a canonical integer 1..64; M is 1..8. Repeated,
missing, zero, negative, signed, padded, fractional and out-of-range values reject
before Core submission. Legacy child/fanout paths reject these flags before
preparation, rather than silently ignoring a requested limit.

Absent flags retain the old unlimited-native numeric field (`nil`, not a claim
of available subscription quota) and max_parallel=4. `--forbid-model-generation`
still overrides numeric allowances. Parent/child retries and fallback dispatches
consume the existing durable Core native counter; old/unknown attempts are not
refunded. The displayed task worker limit carries the same M. Limits are per
submission, not a machine-wide cap; they do not count hidden provider-internal
model rounds. Local generation is a separate resource, not covered by N.

Every new App submission freezes `--max-native-dispatches 16`
(`RCCRunBudgetOptions.appNativeDispatches`) when it is created and passes it on its
`os1 run` argv; resume-delivery replaces the whole argv and takes no budget. A
submission an older build saved keeps no cap across retry and restart, because the
budget is part of Core's submit fingerprint and the same task ID must not become an
idempotency conflict. 16 = 2 x 8: Core's own plan-time reserve of two native
dispatches per node (ownerCollectionPlanEligible: cap >= 2 x obligations;
_calibratedContext: headroom >= 2) over the largest plan or owner collection Core
admits, so no plan-time eligibility outcome differs from an absent cap. It is not a
run-time reserve: the cap counts every native dispatch, including the uncharged
ladder descent and free pre-execution rejections, and nothing reads headroom when a
descent binds, so a late node can exhaust it. A cap hit is a typed hold
(`native_dispatch_budget_exhausted`), never a cheaper delivery: a held task
delivers no certified descent's unaccepted output, and an owner-collection control
unknown holds the whole task whichever child holds first. A direct CLI run without
the flag still means the legacy nil. Rollback raises the constant (at most 64) or
holds dispatch; it never removes the flag (RT-10). Raising the 8-node/8-obligation
bound or max_attempts must raise the constant; `test-native-budget-cli-wiring.py`
pins both sides.

This exposes an existing exact executor constraint for bounded actual evaluation.
It is not quality parity, subscription savings or a new model-selection rule.
