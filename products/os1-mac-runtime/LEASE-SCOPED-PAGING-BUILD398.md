# Build 398: one verified inventory per handoff transaction

This is a source change record, not an installed-performance or complete-product
claim. Actual installed verification is recorded separately.

## Observed boundary

Installed build 397 returned a narrow health response with no native/local
model call. Its Core completed in 0.196 seconds, but the UI saved the answer
32.916 seconds after the user message. Own-session archive record timestamps
and the executed call path show repeated full memory-ledger inventories before
Core submission. Core timing alone must not be presented as user latency.

The same installed build also ran two requested Codex arithmetic workers with
actual `gpt-6-luna / low` native turn intervals overlapping for 2.569 seconds;
both answers, task-tree branches and a linked worker window were observed in
the UI. Separate post-development comparisons generated two actual
`gpt-6.1-sol / medium` outputs against cached direct `Astra / ultra` references.
The code task passed the same frozen tests in both arms. The evidence task had
identical JSON in both arms but both failed the unchanged citation criterion;
the retained grader audit marks that criterion ambiguous. No public/general
parity claim, regrading or additional comparison call follows from this.

## Bounded repair

Reuse the existing exclusive memory-store lease and fully verified inventory
for the ordered writes within one lexical handoff transaction. Keep the two
existing handoff invocations separate. Do not reuse the inventory across an
await, process, released lease or later transaction.

The transaction retains record/raw hashes, metadata validation, parent and
supersession relationships, exact capability references, per-item durability
and current partial-progress behavior if a later append fails. A writer must
not operate after its lexical lease ends or from another thread. No persistent
unchecked cache, pruning, history rewrite, policy omission, new coordinator or
alternate model/transport is introduced.

## Adoption gates

Offline fixtures must compare the original ordered artifact sequence with the
batched sequence, count actual inventory scans, reject corrupt/aliased/missing
parents and escaped writers, and preserve external-writer serialization and
durable earlier writes on later failure. Large synthetic timing is diagnostic,
not a replacement for installed timing or an instruction to mutate live data.

After verified packaging and installation, preserve all existing session,
message, queue, draft and paging state; verify a new UI local health request
still uses the same Core with no models and a visible child. Measure both Core
and full saved-message latency. Native route configuration, source-instruction
binding and observer/adoption invariants from 397 remain unchanged. Existing
quality comparisons retain their 397 source identity; they are not silently
relabelled as fresh 398 comparisons.
