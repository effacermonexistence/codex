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

## Cross-task route learning (policy v37, 2026-09-24)

The owner asked for routing that tries models, keeps the ones that complete
work, prefers the cheaper one, and keeps adapting. Exact-objective feedback
above only helps when the same task is sent again, so every new task used the
static source preference; `gpt-6-astra` was in no preference list.

State. `RoutingBudgetState` (one per owner principal) keeps a `learning`
table: decayed attempts `n`, adopted `s`, and the geometric-mean seconds of
adopted steps, per (provider, model, effort, verification class), with a
7-day half-life. `RouteState` stores the ledger name and the step start time.
After a result's decision persists, `claimLearning(sequence)` lets exactly one
delivery record `adopted = evaluator pass` and the measured step time. Local
steps and `deterministic_exact` are not learned. Prompts, answers and
principals never enter the ledger; tokens are not known server-side, so step
time is the cost signal.

Decision. When the pinned adapter answers `route_learning_schema: 1`, route
starts and retries send `route_learning` (at most 256 rows) and a per-run
`route_seed` to the policy. The v37 adapter keeps every existing constraint
(effort floor, provider pin, inventory, current-run exclusions, same-objective
history, permission and verification profile) and ranks only the tuples those
constraints admit, by expected time to a verified result, where a failure
costs a retry. A bounded share of first attempts tries the cheapest admitted
effort of a model this task class has barely measured, only when an optimistic
estimate beats the best known route; retries never explore. Weights and
priors stay in the private source-locked adapter, as above.

Failure behaviour. An unreadable ledger or an unrecordable outcome is logged
(`route_learning_unavailable` / `route_learning_unrecorded`) and routing
continues without learning. Capability answers are cached per binding for a
minute; failed probes are not cached. Rolling the route core back re-pins v36;
the worker keeps the v36 adapter byte-identical.

## Token learning (policy v38)

Owner order (2026-09-24): every task's completion and token use is recorded
automatically, and routing keeps updating toward fewer tokens, more finished
tasks and less time — the more the account is used, the better it routes.

Structure. This is the backpropagation loop mapped onto routing: the forward
pass is the route decision and its execution; the loss is the time and tokens
spent to reach a verified result; credit assignment charges the step's outcome
to the exact (provider, model, effort, task class) that ran; the update is the
decayed ledger; decay is the learning rate; priors are the regulariser; bounded
exploration keeps the gradient estimate honest for routes rarely taken.

Signal. The device measures each step's usage (input, cache and output tokens)
and signs it with the result (`os1-result-v2`; results without usage keep the
byte-identical `os1-result-v1`). The gateway verifies and forwards it; the
route core converts it to input-token equivalents (fresh input + 0.1 × cache
reads + 5 × output) and adds it to the ledger for every attempt, adopted or
not, since a failed route still spent its tokens. A result without usage (an
older client) records the outcome as unmeasured, never as zero.

Decision. A pinned adapter that answers `route_learning_schema: 2` receives
rows that also carry `k` (geometric-mean weighted tokens per measured attempt)
and `kn`; a schema-1 adapter keeps receiving v37 rows. v38 ranks the admitted
tuples by time to a verified result and tokens to a verified result together,
with completion weighing in both, so a cheaper route never wins by failing.
Tokens are compared against what a typical task spends on the same provider:
Codex and Claude draw on separate quotas, so raw totals never move work
between them. Exploration is optimistic about tokens as well as completion for
routes with few measurements. Constants stay in the private adapter.

Rollout. Route core (accepts usage, stores tokens, still pinned to v37) →
gateway (verifies and forwards usage) → worker hosting v38 beside v37 and v36 →
bundle → route core pinned to v38 → client that sends usage. Each step is
backward compatible with the one before it; rolling the route core back re-pins
v37 and schema-1 rows.
