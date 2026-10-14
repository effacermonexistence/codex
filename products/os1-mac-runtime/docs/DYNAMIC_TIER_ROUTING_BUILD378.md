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

The host then tries these (tier, effort) entries in order; the first one with a
row that can run now wins, in the first pool (by the existing quota order:
capacity share x remaining / hours to reset) that can offer any entry:

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

## REVAS at the front: one escalation on failure

A read-only part bound below the reference carries one escalation target: its
pool's reference, or the other pool's when that one cannot run. If its attempt
settles with any failure signal, the part runs ONCE more at the reference:

- the attempt failed after dispatch with no side effects,
- execution was not verified,
- the answer is empty or whitespace only,
- the native adapter recorded a failure (a failed task quality, or a recorded
  error beside a finished attempt),
- a registered verifier failed it.

The failed answer is never shown as the result. The reference attempt runs in a
fresh native session and is never escalated again; the failed cheaper
attempt's time, cost and attempt count are not charged to the task budget. A writing part is never escalated: it keeps
the existing no-replay / repair behaviour. A pre-dispatch failure (nothing ran,
for example a provider quota rejection before any work) is not an escalation:
the part moves to the other pool at its own grade, as before.

The tier choice itself is the admission; the former requirement of 20 verified
ledger passes no longer applies to tier routing. The routing ledger still
records every attempt with its tier, effort, outcome and whether it was an
escalation, so evidence keeps accumulating.

## Explicit owner words

An explicit effort or model-family word in the owner's own request still wins
and is never escalated:

- **Effort only** ("최대 리즈닝으로", "use high reasoning"): the owner's effort
  replaces the effort; the grade still picks the tier. So "최대 리즈닝" runs
  trivial work on `gpt-6-luna` max, standard work on `gpt-6.1-sol` max and
  deep work on `gpt-6-astra` max. Deep work stays on the frontier model.
- **Model family** ("opus로", "소네트로 돌려"): that family is the model; the
  grade picks the effort (trivial low, standard the first of medium/high/xhigh
  the family offers, deep its highest effort up to max).
- **Both**: exactly that model and effort.
- ultra is used only when the owner asks for it.

## Compatibility

- The catalog gains an optional `model_tiers` field (`{model: tier}` for the
  tiered models it offers; empty when none is tiered). Older catalogs without
  it still decode on both sides and keep the build 377 reference routing.
- A routing decision gains an optional `tier`, and its escalation record
  (`ladder`) optional `cheap_model` / `reference_model`. Older snapshots
  decode unchanged.
- No quota, quality or parity numbers are invented: an unknown quota still
  means a row cannot run, and the tier table only repeats provider wording.

## What this does not prove

Routing a part to a cheaper tier is a prediction that the result will match the
reference; it is not a measured parity claim. The escalation guard catches the
failure signals above, not every wrong answer that looks finished.
