# Qualified route bridge: installed-code contract

This source change connects the existing P7 producer to conditional route
selection in the same OpenClaw Core. It does **not** supply a production
registration, actual training/calibration/heldout data, a representative quality
comparison, subscription-quota measurement or a savings claim.

## One production entrypoint, no task-provided authority

`rcc-plugin.mjs` reads only the fixed host-local
`<OS1_RCC_STATE_ROOT>/calibrated-route-registration.json` through the protected
registration reader. Missing, malformed, stale, revoked or synthetic evidence
adds no predictor. Only `loaded_qualified_evidence` constructs the branded
predictor passed into the existing `createRCCRuntime` call. No new service,
scheduler, model call, queue, API/Chrome/ChatGPT relay or account is created.

This qualification registration is separate from the P9 local-plan proposal
mode. P9 `off` remains off for that planner; it is not a portable authority to
turn serialized calibration fields into a predictor. An approved fixed
registration is a distinct host opt-in, reloaded at owner restart. Revocation
and source changes are checked again before dispatch, not ignored until restart.
No production opt-in is shipped with this patch.

The default preparation path consumes exact protected pre-outcome records.
It does not invent missing tokenizer, capability, native-harness, quota or
semantic-family fields. Initial records bind exact prepared task/node/request,
source and original-plan identities. This is **not yet a general producer for
future GUI-generated UUIDs**. An unmatched GUI task follows original R0.

## Selection does not replace admission or the actual result checker

Only one original, source-free, read-only, first-turn Auto request is eligible.
The existing full-task R0 contract must already certify the candidate entries,
and the independent reference must be runnable with actual fallback budget.
Owner pins, explicit routes, sources/history and generic decompositions retain
their existing paths. The forecast is not a new R0 certifying source.

The pure selector's frontier descriptor and Core's actual original R0 are
separate roles. A proposal must have a strictly lower source-supported resource
estimate than both; every miss preserves original R0. A selected tuple changes
only `candidate_id`, not the original instruction, scope or final owner.
Before native intent, qualification is rechecked against current host state.
No effect-unknown execution is replayed. A failed cheaper full-task check uses
the existing reference ladder once, with failed output and usage preserved.
If the reference is unavailable before dispatch, the original R0 identity is
restored for trace and the task is genuinely held, not called successful.

## Quality and cost evidence remain distinct

P7 match/success estimates, accepted_B, fresh exact-stratum P8, rights/source
review and independent host promotion remain separate gates. TRAIN cost history
must be disjoint from qualification-heldout lineage. Actual physical native
observations must not be counted repeatedly under renamed logical outcomes.

Whole-route resource means include complete TRAIN primary attempts, matched
checker rejection and any exact-reference fallback, native children without
double counting, and disjoint measured host overhead. A single-attempt scalar
cannot be relabeled as a complete remaining-route estimate. Unknown usage or
missing complete history does not become zero.

These are empirical estimates for the initially qualified exact cohort, not
worst-case guarantees. Existing operational recovery can later use a changed
reference/pool. Such a realized trajectory is outside the initial cost estimate
and must not be published or learned as a covered saving. Actual attempt/config
and full resource records, not the original forecast, determine that boundary.
Tokens do not establish cash or subscription-quota consumption.

## Bundle and verification boundary

Source version0.9.356/build422 extends the exact signed bridge inventory from15
to19 code resources. The new loader, predictor and their offline verification
dependencies are included in source/stage/package byte comparisons and native
source pins. Private evidence, synthetic fixtures and review packets are not
bundled. Old <=421 recovery packages keep their original inventories; injecting
new modules into them is rejected.

Software fixtures exercise nonnull forecasts, genuine fake-executor tuple
selection, per-answer checking, fallback, source/lineage/cost failures,
revocation and production rejection of synthetic authority. They do not prove
that the user's overall quality/quota objective has been achieved. Release,
installation, live-path observation and actual-data qualification each require
their own receipts; this document is not such a receipt.
