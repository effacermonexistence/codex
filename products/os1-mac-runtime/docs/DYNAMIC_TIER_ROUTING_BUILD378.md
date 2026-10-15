# Dynamic tier routing (build 378 change set)

Owner objective (2026-10-13): the same result as the newest top model at its
highest reasoning, but with less quota. Build 377 bound every task to one
static route per pool (Codex `gpt-6.1-sol` at max, Claude `opus` at max), so a
one-line question spent the same quota as a hard design task. This change
makes the model AND the reasoning effort dynamic per task.

## Tiers come from the providers, not from OS-1

Each tier below is what the provider's own model metadata says, observed on
2026-10-14 without a model turn. OS-1 copies these words into one table
(`Sources/OS1Context/ModelTiers.swift`); it does not grade models itself.

| Model names | Provider description | Tier |
| --- | --- | --- |
| `gpt-6-astra` | "Frontier intelligence for the most demanding work." | frontier |
| `gpt-6.1-sol` | "Latest workhorse model for coding and everyday work." | workhorse |
| `gpt-6-luna` | "Fast and affordable model for easier tasks." | fast |
| `claude-fable-5-1`, `fable` | "Fable 5.1 · Most capable for your hardest and longest-running tasks" | frontier |
| `opus`, `claude-opus-5-5` | "Opus 5.5 · Best for everyday, complex tasks" (Claude's default) | workhorse |
| `sonnet`, `claude-sonnet-5-5` | "Sonnet 5.5 · Efficient for routine tasks" | efficient |
| `haiku`, `claude-haiku-4-5-20251001` | "Haiku 4.5 · Fastest for quick answers" | fast (no effort control: runs at effort "none", profile `cl_haiku45_none`, build 383) |

`gpt-6-sol` ("Previous generation workhorse"), every `gpt-5.x` / `gpt-5.6-*`
model and `gpt-daybreak-blue-latest` (a specialized cyber model) have no tier.
A model without a tier is never chosen by tier routing; it still runs when the
owner explicitly names its family (for example "daybreak 모델로").

## The reference

A pool's REFERENCE is its frontier model at its highest effort up to max:
Codex `gpt-6-astra` at max, Claude `claude-fable-5-1` / `fable` at max. It is
no longer "the first model of the native list" (that was the workhorse). A
pool whose frontier model cannot run now (missing, quota exhausted, cooled
after a real quota rejection, or no profile at the owner's effort word) keeps
its lower tiers for light work and records `reference_unavailable`: it is
never used for deep work or for an escalation, and nothing lower stands in.

## Grade, then the cheapest tier for the grade

The local planner grades each part of a task (it never sees model names):

- **trivial**: a short factual answer, lookup, formatting or one step.
- **standard**: normal coding, analysis or multi-step but routine work.
- **deep**: hard design, debugging a non-obvious failure, a proof,
  long-horizon work, or anything the owner flags as important or hard.

The host then tries these (tier, effort) entries in order; in each pool the
first entry with a row that can run now is that pool's offer, and among the
pools that can offer one the pool is chosen by the quota of the model it would
actually spend (capacity share x THAT model's remaining quota / hours to its
own reset, sent by the catalog builder as `quota_scores`; unknown quota last,
ties keep the catalog's pool order). A nearly exhausted workhorse or fast model
is therefore not spent while the other pool's model of the same grade has room,
even when that pool's frontier model ranks it first for deep work:

| Grade | Entries, in order |
| --- | --- |
| trivial | fast/low, efficient/low, workhorse/low |
| standard | workhorse/medium, efficient/medium, workhorse/high, workhorse/xhigh, frontier/max |
| deep | frontier/max (the reference only) |

With the current signed profiles this means, for example:

- trivial read-only question: Codex `gpt-6-luna` low, or Claude
  `claude-haiku-4-5-20251001` at effort "none" (build 383; see "Effort none"
  below), escalating once to `claude-fable-5-1` max on a failure signal
- standard: Codex `gpt-6.1-sol` medium, or Claude `claude-opus-5-5` medium
  (build 383 added the opus, sonnet and fable 5.1 medium/high profiles; before
  that opus had no medium profile and Claude standard work bound `sonnet` medium)
- deep: Codex `gpt-6-astra` max, or Claude `claude-fable-5-1` max (never sol or opus)

A writing part graded trivial runs at least standard. A part with a missing or
invalid grade runs standard. Read-only parts on the Anthropic pool still take
the tool-free chat lane when its gate allows, at the same model and effort.

When no pool can offer any trivial entry (for example only the frontier model
can run because the cheaper models are cooling down), a trivial part runs the
standard list instead of being held, so it may run on the frontier model. The
routing reason says `class_fallback_trivial_to_standard`. This only goes
upwards: standard and deep parts never fall back to a lower tier.

What the planner is told can run counts only models some grade can actually
use in that scope. A writing part never runs the fast tier, so a pool whose
only runnable models are fast offers no writing work; when nothing at all can
run, the task is held before planning with the per-pool cause
(`no_bindable_tier` for rows no grade can use).

## REVAS at the front: one escalation on failure

A read-only part bound below the reference carries one escalation target: its
pool's reference, or the other pool's when that one cannot run. If its attempt
settles with any failure signal, the part runs ONCE more at the reference:

- the attempt failed after dispatch with no side effects,
- execution was not verified,
- the answer is empty or whitespace only,
- the native adapter recorded a failure (a failed task quality, or a recorded
  error beside a finished attempt). This includes `native_tool_failed`: a
  finished read-only attempt during which a tool call of the model's own BROKE
  DOWN and was never recovered: the native transport declined it (it never
  ran), or a non-command tool (an MCP, dynamic, web-search or collaboration
  call) returned an error, with no later tool call of the model's own
  succeeding. Ordinary exploration never counts: a command that ran and exited
  non-zero (`rg` with no match, a failing test being inspected, `test -f`), a
  missing file, a write the read-only sandbox refused, and every Claude tool
  error (Claude does not tell those apart from a broken call). Escalating those
  would pay for the cheaper attempt AND the reference, more than routing to the
  reference directly. A permission denial already fails the attempt. An answer
  on the reference or on an explicit route is delivered unchanged with that
  note,
- a registered verifier failed it.

The failed answer is never shown as the result. The reference attempt is never
escalated again. Because the cheaper answer may be discarded, the cheaper
attempt runs in a fresh native session, never inside the owner's Codex or
Claude thread; the escalated reference then continues the owner's thread of
its provider untouched, so it never builds on the failed turn and the thread
never ends with a discarded answer. A cheaper answer that passes is delivered
from its own fresh session, and that session does NOT replace the
conversation's thread: the step is marked `native_session_detached` and the app
keeps the conversation bound to its own thread, which the next turn resumes
(the recent conversation still travels to every attempt in host context). The
same holds for each part of a multi-part plan, which already ran in fresh
sessions. With no thread bound yet, the delivered session becomes the
conversation's, as before. (Running the cheaper attempt inside a fork of the
owner's thread would also give it the thread's native context; that needs
native session forking, which this change does not add.)

If the catalog the guard was bound to has aged out while the cheaper attempt
ran (its rows are valid for 120 s), the escalation still looks for its
reference as last observed, and when it finds none there it refreshes the
catalog once and looks again before holding the part. The failed cheaper attempt's time, cost and attempt count are not
charged to the task budget; cheaper attempts that ran at the same time are
exempted once (the union of their wall time, not the sum). A writing part is never escalated: it keeps
the existing no-replay / repair behaviour. A pre-dispatch failure (nothing ran,
for example a provider quota rejection before any work) is not an escalation:
the part moves to the other pool at its own grade, as before.

When no pool offers a runnable frontier reference (for example the frontier
model's quota is exhausted and the other provider is not admitted), light
read-only work still runs on the lower tiers, with the same guard: a failure
signal then holds the part (`ladder_reference_unavailable`) instead of
delivering the cheaper answer. If a frontier model can run again by the time
the cheaper attempt fails, the part escalates to it.

The tier choice itself is the admission; the former requirement of 20 verified
ledger passes no longer applies to tier routing (the cost gate below can only
send a node to its reference, never admit a cheaper one). The routing ledger still
records every attempt with its tier, effort, outcome and whether it was an
escalation, so evidence keeps accumulating. A failed cheaper attempt also
records what its one escalation did (`escalation_outcome`: `escalated`, or the
reason the part was held instead, for example `ladder_reference_unavailable`),
so the ledger tells how often the guard escalated, found no reference, or was
blocked by reported effects.

## Cost gate: tier or reference, decided from the ledger

The guard above makes a failed cheaper answer cost the cheaper attempt AND the
reference. Whether a cheaper route is still worth trying is therefore not a
matter of taste: it follows from what the routing ledger has observed, by one
exact comparison and one owner-tunable confidence level.

### The criterion (exact for this structure)

For one read-only node graded below its reference, let `mu_C` be the mean cost
of one attempt on the cheaper route, `mu_R` the mean cost of one attempt on the
reference, and `p` the probability that a cheaper attempt ends with a failure
signal (and so escalates). Then

- tier, expected cost: `mu_C + p * mu_R` (the cheaper attempt always, the
  reference once with probability `p`);
- reference directly, expected cost: `mu_R`.

Whatever a reference run does (delivers, is held, or fails after dispatch) it
does the same in both arms and is never escalated again, so `mu_R` is the mean
over EVERY reference run that ended on its own, failed runs included (leaving
the failed runs out would make the reference look cheaper than it is). The
tier costs more exactly when `mu_C + p * mu_R > mu_R`, that is when
`p > 1 - mu_C / mu_R`. Nothing in this inequality is a chosen threshold: a
cheaper route at 20% of the reference's cost is worth trying until it
escalates more than 80% of the time; one at 90% of the cost stops being worth
it above 10%.

### Estimating p, mu_C and mu_R (no new store)

The gate reads the existing routing ledger (both retained generations,
parsed once per file change). For the node's family (route class, scope,
surface kind) and pool:

- **cheaper attempts**: the same cheaper model and effort on a `tier` route
  that was not itself an escalation. Each settled one is an escalation trial:
  `ladder_not_returned` / `ladder_verifier_failed` (a failure signal, escalated
  or held) count 1, `completed` (adopted) counts 0; interrupted, cancelled,
  effects-uncertain or never-dispatched attempts are no evidence either way.
  The ones with recorded usage are its cost samples (an attempt without usage
  still counts as a trial, so a missing usage report on failures cannot make
  `p` look smaller);
- **reference attempts**: the escalation target's model and effort in its pool
  on a `reference` route (bound directly or escalated to) that ended on its
  own, with usage: `completed`, `held`, or failed after dispatch with no side
  effects reported. Such a failure is still recorded `effects_uncertain` (the
  node is never replayed) and carries the optional ledger field
  `dispatched_failure: "no_effects"`, which only the executor's own report of
  that outcome sets; a cancelled, stopped, interrupted or never-dispatched run
  (cut short, or never run, the same as on the cheaper side) is no sample.
  Family first; when the family has fewer than two, the same pool, model and
  effort at any class with the same scope and surface kind (never a write or
  another surface kind).

A named route the host graded (a fan-out test without its own words) is
recorded with `route_kind: "explicit_route"` as before and an optional
`host_route_kind` (`tier`, `reference` or `explicit`): the gate reads its
`tier` and `reference` attempts like any other, so a named route learns from
its own attempts. An older named-route record without that field is no
evidence.

Cost is a **token proxy**: `input_tokens + output_tokens + reasoning_tokens`
as the ledger recorded them. The Swift usage normalizer already folds cached
input into `input_tokens` for both providers, so `cache_read_tokens` is not
added again; the current executor does not report `reasoning_tokens`, so it
adds 0 today (if a future executor reports it as a part of `output_tokens`,
this sum would count it twice and must be revisited). This is **not
subscription quota**: how much quota one token of each model spends is not
observable here and may differ by model, and no calibration is claimed.

### What tokens can and cannot decide

Write `w` for the quota one token of the cheaper model spends relative to one
token of the reference model. The provider's tier order is the only thing
known about it: a cheaper tier does not spend MORE per token, `w <= 1`. In
quota the rule is `w * mu_C + p * mu_R > mu_R`, so tokens (`w = 1`) overstate
the cheaper attempt, and they would send a node to the reference on the
cheaper model's own token count even when it never fails (an agentic cheaper
model that re-reads as much context as the frontier). The gate therefore lets
tokens decide only where the extra cost comes from escalations:

- at least one cheaper attempt must have escalated (`cost_gate_no_escalation`
  otherwise: nothing observed can make the tier cost more except its own
  token count);
- the cheaper route's mean token cost must be below the reference's
  (`cost_gate_unidentified` otherwise: tokens contradict the tier order, so
  they cannot rank the arms without `w`), at any confidence;
- `P_more` counts only posterior draws in which the cheaper attempt is
  cheaper, as the tier order says: `P_more = Pr[mu_C < mu_R and
  mu_C + p * mu_R > mu_R]`. A draw where tokens say the cheaper attempt alone
  costs at least a reference attempt is not counted as "more" (the cheaper
  model's quota could be far lower); so a cheaper route whose token cost is
  within the noise of the reference's keeps the tier even when it escalates
  often, until either a quota weight is observable or its token cost is
  credibly lower.

These are identifiability conditions on the token proxy, not cost thresholds:
none of them has a tunable number.

### Posterior and decision

- `p ~ Beta(1 + escalations, 1 + trials - escalations)` (uniform prior).
- Each mean cost (the sample MEAN, because the decision is about expected
  cost, not the median) has the posterior of a mean under the usual
  noninformative prior: Student-t with `n - 1` degrees of freedom, located at
  the sample mean with scale `sd / sqrt(n)`, truncated to `> 0`. As `n` grows
  this is `Normal(mean, sd / sqrt(n))`; for few samples it is wider, so thin
  evidence is less confident.
- `P_more` (above) is estimated by Monte Carlo with `COST_GATE_DRAWS = 4000`
  draws (standard error at most 0.008). The generator (xoshiro128**,
  Box-Muller normals, Marsaglia-Tsang gammas, Beta as `X / (X + Y)`,
  Student-t as `Z / sqrt(V / df)`) is seeded from a SHA-256 of the exact
  evidence and the draw count ONLY, never the confidence: the same evidence
  has one `P_more`, a retuned confidence never changes a recorded `P_more`,
  and a higher confidence can only keep more nodes on the tier. `P_more` is
  reported as the exact fraction `more / draws` the rule compares (for
  example `0.89975` = 3599/4000), never rounded, so a recorded value can never
  sit on the wrong side of the confidence.
- The node goes **straight to the reference** (the guard's own escalation
  target, which must be able to run now) only when `P_more >=
  COST_GATE_CONFIDENCE`. That constant, 0.9 by default, is the one owner-tunable
  number: how sure OS-1 must be that trying the cheaper route spends more
  before it stops trying it. It is a confidence level, not a cost threshold.
- **Exploration (posterior probability matching).** A node sent to the
  reference adds no new cheaper samples, so without exploration the posterior
  of `p` would freeze and one or two early failures could lock a family to the
  reference for as long as the ledger keeps them. So even when the gate is
  confident, each task node still tries the tier with probability
  `1 - P_more`: its exploration draw, a deterministic integer in `[0, 4000)`
  from a SHA-256 of the task id and node id, keeps the tier when it is
  `>= more`. This is Thompson-style probability matching restricted to the
  confident region; it has no parameter of its own. The same node decides the
  same way at bind, re-resolution and pool spread, and an explored attempt is
  an ordinary cheaper trial in the ledger, so the posterior keeps moving. Its
  expected extra spend is at most `1 - COST_GATE_CONFIDENCE` of the gated
  tasks. Recovery after a transient streak takes as many tasks as that rate
  implies (the evidence is not time-decayed: the gate assumes the cheaper
  route's failure rate is stationary).

Every gated route says why in its routing reason, and its ledger records keep
the decision (`cost_gate`: reason, `p_mean`, `cost_ratio`, `p_more`, and the
optional `confidence`, `draws` and `explore`). `p_more` and `explore` are the
exact fractions compared (reference iff `p_more >= conf` and, when `explore`
is present, `explore < p_more`); `cost_ratio` is rounded to 3 decimals
towards the side the rule reads (below 1 exactly when the cheaper mean is
below the reference mean):

- `cost_gate_reference:p_mean=…:cost_ratio=…:p_more=…:conf=…:explore=…:trials=…:escalations=…:cheap_n=…:ref_n=…:ref_family|ref_pool`
  plus `cost_gate_cheap_<model>_<effort>` (the route it replaced);
- `cost_gate_explore:…` (same numbers): confident, but this task node's
  exploration draw keeps the tier route and its guard;
- `cost_gate_tier:…:p_more=…:conf=…:…`: not confident, the tier route and its
  guard run as before;
- `cost_gate_no_escalation:p_mean=…:cost_ratio=…:trials=…:…` and
  `cost_gate_unidentified:…` (same shape): tokens cannot decide (above): tier;
- `cost_gate_insufficient:trials=…:…`: fewer than two cost samples in either
  arm (the spread is undefined) or a zero mean cost: tier;
- `cost_gate_unavailable`: the gate would otherwise decide from partial
  evidence: the ledger could not be read safely (not private, a link,
  oversize); a record that is cost evidence or a parity failure could not be
  written and waits in the backlog (any tier or reference attempt, whatever
  its verifier outcome: a lost cheaper failure would make the tier look
  cheaper, a lost cheaper success or reference cost the reference); or a tier
  or reference attempt of this process has returned but is not recorded yet
  (its escalation, verifier or catalog refresh still runs): tier;
- `cost_gate_no_reference`: no escalation target can run now: tier.

The gate applies only to a graded read-only tier route below its reference
with no owner effort or model-family word (a named route without its own
words included, and then only on that route's own surface). A write, an owner
constraint, a route already at its reference and an escalation never consult
it. It runs the same way at bind time, at a re-resolution and when a node
moves pools for parallelism.

### What the gate does not claim

- No quota calibration: the comparison is in tokens, under the stated
  assumption `w <= 1`. With `w < 1` the exact quota rule
  `w * mu_C + p * mu_R > mu_R` favours the tier more than tokens do, so a
  token decision for the reference can still be wrong in quota when the
  cheaper route's token cost is close to the reference's; the
  identifiability conditions above only keep the gate from acting where
  tokens alone would decide.
- No quality parity: the gate compares cost only; the guard still catches
  only the failure signals listed above.
- The escalated reference is assumed to cost, in expectation, what a direct
  reference attempt on the same family costs. Escalated tasks are the ones the
  cheaper model failed and may be harder; family reference samples are mostly
  such escalations. The pool fallback mixes route classes.
- Token counts are skewed; the mean's posterior relies on the usual
  large-sample behaviour of a mean, widened by Student-t for small `n`.
- Stationarity: escalation trials are not time-weighted. Exploration keeps
  the evidence moving, but an old failure streak still weighs as much as a new
  one until it leaves the ledger's retained window (two generations of
  4 MiB). A torn or foreign ledger line is skipped as one missing sample.
- The ledger cannot always tell a failure from a cancel: only a failure the
  executor itself reported after dispatch with no side effects is marked
  (`dispatched_failure`); a failure with reported or unknown effects is no
  sample on either side.

## Effort "none", the one-shot Claude cache and wrapped exact arithmetic (build 383)

**Effort "none" means the model has no reasoning-effort control.** On
2026-10-15 the Claude CLI 2.1.290 `initialize` inventory (no model turn) listed
`opus`, `claude-fable-5-1[1m]` and `sonnet` with efforts low..max, and a row
`haiku` (resolved `claude-haiku-4-5-20251001`, "Haiku 4.5 · Fastest for quick
answers") with `supportsEffort` and `supportedEffortLevels` absent. A live
`claude -p --model haiku` with no `--effort` answered on that model. So:

- local is always "none" (`local-deterministic`), Codex never (every Codex model
  lists its efforts), and Claude takes "none" only for a native row with no
  effort control. `ModelAvailability.claudeRows` maps exactly that shape
  (flag absent/null/false, levels absent/null/empty, a resolved model) to
  `["none"]` and skips anything half-stated; the executor admits "none" only
  for a row whose efforts are exactly `["none"]` and then passes no `--effort`.
- The signed profile is `cl_haiku45_none` (production now has 85 profiles:
  build 383 also added `cl_opus55_medium/high`, `cl_sonnet55_medium/high` and
  `cl_fable51_medium/high`).
- In tier routing an effortless model satisfies its tier's entry at any
  concrete effort, never under an owner effort word (it cannot honour one):
  "use medium reasoning" excludes haiku, while the family word "haiku로 돌려"
  runs it. Auto routing never binds it for a writer (the fast tier is
  trivial-only and a trivial write is promoted to standard); an explicit haiku
  family word binds it at every grade, writes included, as the owner's route.
- The legacy router never sees an effortless row, and an RCC authorization
  sends one in `available_claude_models` only when the selected tuple is that
  model at "none", so an older gateway's "none" validator never refuses
  another tuple's request. An older gateway or policy bundle still refuses
  every tuple build 383 added, the six medium/high actions as well as
  `cl_haiku45_none` (see Compatibility).

**One-shot Claude sessions use the 5-minute prompt cache.** Every Claude call
wrote its whole prefix with the 1-hour TTL (2x base input at API prices), and
same-surface calls are usually more than an hour apart, so it was never read.
Replaying 57 historical chat-lane calls at API multipliers: -32.6% input-side
cost with `CLAUDE_CODE_PROMPT_CACHE_TTL=5m` (an API-price estimate, not
measured subscription quota). The CLI honours it (usage moved to
`ephemeral_5m`, and an immediate second call read the cached prefix). OS-1
sets it only for a session that starts new and is one-shot: the tool-free chat
lane, a source-only answer, and an RCC delegated child that starts a side
session beside the conversation's existing Claude thread (a cheaper REVAS
attempt, one part of a plan). A session that may become the conversation's
thread keeps the CLI default: a conversation's first agent session (nothing
bound yet, nothing resumed) is bound as its thread and resumed on the next
turn, where only the 1-hour cache can still be read. It is an environment
override (OS-1 strips inherited `CLAUDE_CODE_*`), and the pre-dispatch
governance receipt still hashes instructions and input only.

**Wrapped exact arithmetic takes Core's zero-model route.** A plain Auto
"1+1이 뭐야?" had run Codex `gpt-6-luna` low (29K input tokens) and still ended
`returned_unverified`. Core's existing exact route (Auto, no owner provider
choice, no attachments, no explicit routes) now also admits a closed set of
question wrappings around one sum or product ("1+1이 뭐야?", "what is 2*3?",
"1+1=?"), and only when the task carries no earlier conversation (no context
text, no native session to resume): after "1+1 상품은 3,500원", "1+1은
얼마야?" asks a price, so it goes to the models with that context. The bare
expression keeps its earlier reading. Anything else stays with the models. The
host shows "정확한 산술식이라 OS-1이 로컬에서 계산·검증했습니다 · 모델 호출·구독
사용량 없음" when the bound `local-core` child's output is an integer (Core's
check-in, the only other zero-model answer, is a sentence), and names the local
planner model only once Core has bound a planned child, never for a task Core
answers with no model or holds before planning (Core's `planning` state
precedes its catalog probe).

## Delegated read-only Claude children run without interactive hooks (build 384)

The first live haiku child on build 383 (2026-10-15, task ed67fc5c, Claude
preference, "대한민국의 수도는 어디야? 도시 이름만 답해.") bound
`claude-haiku-4-5-20251001`/none as designed, but answered with a Bash check
and the note "OhMyBug MCP tools are not present in this session ..." before
"서울". The owner's `~/.claude` plugin SessionStart hook had injected "First
thing this session: confirm the OhMyBug MCP tools ... tell the user once,
now" into the delegated child. Sonnet had ignored it; haiku obeyed it. That
answer is not at parity with the reference.

Those hooks address the owner's interactive sessions. A child the RCC adapter
delegates has no interactive user, and a read-only one changes nothing a Stop
guard could keep, so its one `--settings` value (the read-only shell sandbox,
or a settings object of its own on the tool-free lane) also carries
`"disableAllHooks": true`. The same CLI call with that setting fired no hook
and answered the city alone. Writers, and OS-1's own conversational sessions,
keep the owner's hooks (the remote completion guard among them); the shell
sandbox, tools, permissions and MCP scope of the read-only lane are unchanged.

## Explicit owner words

An explicit effort or model-family word in the owner's own request is a hard
constraint. When it fixes only one dimension, the host still chooses the
other, so that host choice keeps the same guard as any cheaper route:

- **Effort only** ("최대 리즈닝으로", "use high reasoning"): the owner's effort
  replaces the effort; the grade still picks the tier. So "최대 리즈닝" runs
  trivial work on `gpt-6-luna` max, standard work on `gpt-6.1-sol` max and
  deep work on `gpt-6-astra` max. The model below the frontier was the host's
  choice: that part is guarded against the frontier at the owner's effort
  (`gpt-6-astra` max), runs in a fresh session, and a failure signal re-runs it
  once there. Deep work on the frontier at the owner's effort is the owner's
  own route.
- **Model family** ("opus로", "소네트로 돌려"): that family is the model; the
  grade picks the effort (trivial low, standard the first of medium/high/xhigh
  the family offers, deep its highest effort up to max). An effort below the
  family's highest (up to max) was the host's choice: guarded against that
  family at its highest effort, the same way.
- **Both**: exactly that model and effort, never escalated, in the owner's
  thread.
- ultra is used only when the owner asks for it.

## Named-route fan-out tests ("1+1 Codex chat한테. 3+3 Claude Code한테. 4+4 Claude한테.")

When the owner names which surface runs each part, the named surface is the
owner's; the model and the reasoning effort are graded like any other part.
The local planner no longer picks a row (it never sees the catalog or a
candidate ID there); it grades each named route, and the host binds that
route's model and effort from the same lists, on that route's own surface
only. "1+1" on Codex therefore runs `gpt-6-luna` low, "3+3" on Claude Code
and "4+4" on the Claude chat lane `claude-haiku-4-5-20251001` at effort "none"
(build 383; `claude-sonnet-5-5` low before): never `gpt-6-astra`, Fable, Opus,
max or ultra for a one-step answer. A failed cheaper answer on a named route
re-runs once on the reference of THAT surface (Codex `gpt-6-astra` max, Claude
Code or the Claude chat lane `claude-fable-5-1` max), never on another surface;
with no reference on that surface the part is held. On an older catalog without tiers the planner still picks exact rows.

The catalog can also carry a route's own effort or model words, so that they
would constrain that route only (sent per route as `explicit_route_intents`;
ultra only on a route whose own words ask for it). No production fan-out
carries such words today: `RouteFanout.plan` splits a sentence into named
routes only when every part is a bare arithmetic expression, so
"최대 리즈닝으로 1+1 Codex한테. 3+3 Claude Code한테." or
"astra로 돌려 1+1 Codex한테. 3+3 Claude Code한테." is not split into named
routes at all (checked with the real splitter), and the field is never
emitted. A bare family before a payload is no model word either: the parser
reads "astra로 돌려 1+1" as the astra family but "astra로 1+1" as nothing (it
needs a directive verb, a version or a product word).

## Compatibility

- The catalog gains an optional `model_tiers` field (`{model: tier}` for the
  tiered models it offers; empty when none is tiered). Older catalogs without
  it still decode on both sides and keep the build 377 reference routing.
- Two more optional catalog fields: `quota_scores` (`{model: score}` in
  integer parts per billion, only for models with known quota) and, in a
  named-route test whose routes carry their own words, `explicit_route_intents`
  (one entry per route of the original list, null for a route without words).
  Both are strictly checked on both sides and absent in older catalogs.
- A delivered RCC step may carry `native_session_detached: true`; older steps
  without it decode and keep the former binding.
- A routing decision gains an optional `tier`, and its escalation record
  (`ladder`) optional `cheap_model` / `reference_model`. Older snapshots
  decode unchanged.
- A routing-ledger record gains an optional `cost_gate` (null when the gate did
  not apply; inside it `confidence`, `draws` and `explore` are optional too),
  an optional `host_route_kind` (a graded named route's host route kind, else
  null) and an optional `dispatched_failure` (`"no_effects"` or null); the gate
  reads older records without them (an older named-route record is then no
  evidence). A failed attempt's history entry may carry the same
  `dispatched_failure`, so a restart records it too. The routing decision
  shape is unchanged: the gate's numbers travel in its `reason`.
- No quota, quality or parity numbers are invented: an unknown quota still
  means a row cannot run, and the tier table only repeats provider wording.
- Build 383 signs 85 execution profiles (seven added: `cl_opus55_medium/high`,
  `cl_sonnet55_medium/high`, `cl_fable51_medium/high`, `cl_haiku45_none`). The
  routing server authorizes only actions its gateway compiled and its pinned
  policy bundle carries; the deployed servers (commit `fd1924a1`, bundle
  `os1-policy-20261008-v66`) carry 78. Release order: the private core that
  parses claude/"none", then the gateway, then the policy rollover and re-pin
  with the 85 profiles, then the client. Never roll the private core back
  below that parser while a bundle with `cl_haiku45_none` is pinned: an older
  parser rejects the whole bundle. Before publishing or installing 383, run
  `node products/os1-route-core/scripts/deployed-profile-authorization-smoke.mjs
  <private-receipt.json>` (route-only, no model call); it must pass for
  `cl_opus55_medium` and `cl_haiku45_none`.
- A client that still meets an older server is slower, not broken: the
  gateway's opaque refusal (HTTP 400) of an authorization request becomes the
  typed `native_authorization_refused` (not dispatched, no effects, either
  scope), which Core does not charge to the attempt budget. The node moves to
  another row within `MAX_RE_RESOLUTIONS`; Claude-only standard work then runs
  on `sonnet` medium after two refused rows. Transport failures and 5xx stay
  charged.

## What this does not prove

Routing a part to a cheaper tier is a prediction that the result will match the
reference; it is not a measured parity claim. The escalation guard catches the
failure signals above, not every wrong answer that looks finished.
