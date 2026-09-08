# Exact-objective completion feedback: local candidate design

Status: implemented, deterministically tested, and remotely deployed through
the source-locked v26 adapter on 2026-09-08. This note does not assert measured
production savings or a new global completion probability. Protected policy
text and numeric weights are deliberately omitted.

## Objective and boundary

Select an executable route that meets the existing source-locked RCC effort
floor and fixed authority constraints first; only then compare supported,
retry-inclusive observed token volume. A cheap failed first call must not beat
a supported completion merely because its first-call estimate is smaller.
The existing maximum-step budget, provider pin, permissions, signed execution
profiles, source hashes, evaluator authority, and deterministic lane remain.

The public wire adds optional `execution_context.completion_feedback` with
`schema: 1`, the SHA-256 of the exact transmitted UTF-8 routing task, and at most
16 observations. Each has provider, model, effort, outcome, input/output token
counts, and duration. Outcomes are adopted, quality_failure, timeout, or
capability_failure. Token counts and duration are nonnegative safe integers or
null. No prompt, source contents, answer, gold literal, private rule, or scorer
instruction is allowed. The runtime is responsible for including the exact
source/context identity in the routing task; the server verifies task binding,
not independently possessed source bytes.

`GET /v1/capabilities` returns only `completion_feedback_schema: 1` or null.
Support requires the gateway, private service, and pinned RCC policy to agree.
Clients must negotiate before adding metadata. Existing clients and v16
in-flight dispatch remain supported. Explicit empty executable Codex catalogs
are allowed only on the feedback-v1 path and never synthesize a static fallback.

## Decision and state changes

1. Public and private boundaries validate exact schema and task SHA before a
   private start budget is consumed. RCC repeats the task-SHA check.
2. Candidate construction uses only the supplied executable catalog and
   existing Claude profiles, available providers, and the source-policy floor.
   All supplied Codex candidates that meet the floor remain visible; existing
   source model preferences break ties instead of hiding alternatives.
3. Private RouteState separately stores server-owned current-run observations.
   Failed current-run tuples are hard exclusions. Local executions add no
   invented provider observation, so historical failures cannot become current
   failures through positional inference.
4. Historical failed tuples are avoided when another eligible candidate exists.
   If all history is failed, a later run can recover within the unchanged step
   budget, preferring fewer observed failures then the source prior. This is
   bounded recovery, not a probability estimate or permanent model blacklist.
5. Matching adopted observations take precedence over unknown completion
   evidence within the eligible set. Comparable completed-path token totals
   include every intervening failed attempt, across providers. Missing usage or
   a potentially truncated 16-row window disables measured comparison. Source
   prior ordering is retained when usage is unknown; billing remains null.
6. An exhausted eligible set produces a policy-pinned internal no-eligible
   signal, converted to the existing opaque terminal failed response. Retry
   state is advanced terminally rather than leaving this condition as a generic
   result-transport error.

Evaluator-derived observations know adoption versus non-adoption but do not
know exact provider token usage, backend duration, or a detailed failure class.
They therefore append null usage/duration and the coarse quality_failure
outcome. Runtime-observed historical usage can be exact; same-run total-token
comparison remains unknown when any synthetic observation lacks usage.

## Research mechanism and limits

[FrugalGPT](https://arxiv.org/html/2305.05176v1) motivates accumulating the cost
of all calls up to acceptance. This implementation adopts that accounting
discipline only, not its learned scorer, historical API prices, or reported
savings. [RouteLLM](https://arxiv.org/html/2406.18665v4) learns relative model
preferences from task data; its preference output is not an OS-1 objective
completion probability. No such probability is introduced here. The inspected
REVAS benchmark failure-memory mechanism similarly motivates keeping verified
adoption and resource failures distinct; this bounded exact-objective ledger
is not a claim to implement or validate the full trained REVAS system.

Raw input plus output token counts across providers measure reported token
volume, not equal economic units. Sample means of completed paths are
descriptive observations, not causal estimates of the next route or proof of
minimum billing. Hidden reasoning/cache usage, missing observations, source
retrieval correctness, unseen objectives, and the evaluator's substantive
quality judgment remain separate limitations.

## Verification and rollback

Local tests cover exact schema rejection, cross-objective rejection before
budgeting, capability/version mismatch, old-client behavior, pinned v16
dispatch, empty executable catalogs, effort floors, provider pins, all known
failure outcomes, alternative admitted models, same-run exclusion, historical
recovery, local-step/history separation, completed-path retry volume, unknown
and truncated usage, source-lock identity, and no-eligible terminal handling.
The API test uses service mocks. A separate pinned-Miniflare/workerd SQLite
integration test now checks actual persisted pre-column migration across worker
restart, current-run lifecycle, named-object isolation, and transactional
rollback (4/4). This is local storage-engine evidence, not a production migration
or remote end-to-end activation result.

The v16 adapter is preserved as a separate source-locked module and the staging
allowlist includes it. The rollover builder derives the adapter version from
the candidate file and supports v17 without hard-coded version changes.
Rollback means repinning the prior immutable policy/adapter while keeping the
new binary capable of servicing already-issued tickets; do not erase route
state or replace source authorities. Deployment authority is external to this
design note and was exercised separately with verified rollout evidence.

Deferred transport risk: the existing gateway result claim has no expiring
claim lease. An unrelated private evaluation/network failure can still leave
a claimed result pending; fixing that lease is outside this patch. The legacy
epoch-week initial-route counter is also not a rolling or retry usage ledger
and is not used as measured cost by this implementation.
