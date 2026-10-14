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
| `haiku` | "Haiku 4.5 · Fastest for quick answers" | fast (no signed profile, never routable) |

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

- trivial read-only question: Codex `gpt-6-luna` low, or Claude `claude-sonnet-5-5` low
- standard: Codex `gpt-6.1-sol` medium, or Claude `sonnet` medium (opus has no medium profile)
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
ledger passes no longer applies to tier routing. The routing ledger still
records every attempt with its tier, effort, outcome and whether it was an
escalation, so evidence keeps accumulating. A failed cheaper attempt also
records what its one escalation did (`escalation_outcome`: `escalated`, or the
reason the part was held instead, for example `ladder_reference_unavailable`),
so the ledger tells how often the guard escalated, found no reference, or was
blocked by reported effects.

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
`claude-sonnet-5-5` low, "4+4" on the Claude chat lane `claude-sonnet-5-5` low:
never `gpt-6-astra`, Fable, Opus, max or ultra for a one-step answer. A failed
cheaper answer on a named route re-runs once on the reference of THAT surface
(Codex `gpt-6-astra` max, Claude Code or the Claude chat lane `claude-fable-5-1`
max), never on another surface; with no reference on that surface the part is
held. On an older catalog without tiers the planner still picks exact rows.

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
- No quota, quality or parity numbers are invented: an unknown quota still
  means a row cannot run, and the tier table only repeats provider wording.

## What this does not prove

Routing a part to a cheaper tier is a prediction that the result will match the
reference; it is not a measured parity claim. The escalation guard catches the
failure signals above, not every wrong answer that looks finished.
