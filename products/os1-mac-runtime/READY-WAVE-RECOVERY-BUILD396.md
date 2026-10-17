# Build 396: bounded execution-path repairs

Status at source freeze: offline verified; installed execution and quality
qualification are separate gates. This document is not a completion receipt.

## Observed failures retained

Build 395 returned two explicit Codex arithmetic answers with actual
`gpt-6-luna / low` native records and a coordinator plus two visible workers.
Its native turn intervals did not overlap: a 400 ms gap remained. Core adapter
overlap must not be substituted for native turn overlap.

The two-task diagnostic then retained two distinct failures before native model
generation: an authorization HTTP 503, and an invalid mixed request/DAG planner
object. The file-edit task also exposed an independent catalog scope error:
protecting named files was interpreted as prohibiting all workspace edits.
Neither failed answer is reclassified as successful by these repairs.

## Changes

* Share one fresh catalog observation only among already-ready, independent,
  fresh-thread, read-only Codex siblings of the same parent. Account/source/
  policy/plan/catalog binding, expiry, cancellation, failure, ownership and
  durable pool reservation checks still apply. Native inventory, quota and
  authorization checks remain per child. Writers, continuations, retries,
  resumed threads and new/foreign waves do not use this optimization.
* Compact planner v2 uses one `nodes` envelope. A single empty instruction
  means byte-exact host-side original-request binding; actual decomposition
  uses bounded nonempty instructions. Historical mixed v1 output remains
  invalid. There is no parser fallback that salvages an invalid answer.
  A production local grammar probe subsequently exposed another schema/decoder
  disagreement: a read-only node carried a `paths` annotation that the mixed
  scope schema offered. The bounded compiler treats only valid, offered
  annotations as non-adopted metadata; a read-only node always has zero owned
  paths and read-only execution authority. Unknown fields or unoffered paths
  remain invalid. The raw failed probe remains a failed observation, not a
  successful runtime execution. Planner instructions also distinguish execution
  units from reasoning steps: routine checks and a completion report stay in
  the same worker unless independent work actually requires another worker.
* A closed, uniquely targeted supplied-file edit may coexist with preserved
  named-file exclusions. Global no-write requests, conflicting targets and
  unresolved targets remain restricted. An unrelated quote-boundary defect is
  covered separately: quote spans are paired before their contents are tested,
  so a closing filename delimiter cannot become a new opening delimiter that
  erases the intervening prohibition.
* The route gateway's identity binding gets an 8-second outer deadline while
  its existing nested upstream timeout remains 5 seconds. Denial, positive-cache
  TTL, permission and all nonidentity binding budgets are unchanged. This fixes
  a deadline hierarchy defect, not a proven explanation of every historical
  HTTP 503.

## Verification/adoption requirements

Offline barrier tests distinguish serial admission from concurrent admission;
they do not prove live native overlap. Installed qualification must record two
actual native turn intervals, returned answers and visible task-tree custody.

The small quality diagnostic uses unchanged tasks/checkers with frozen answer
locks. Any post-repair replay is development/reproduction evidence, not fresh
held-out public proof. Cached reference answers retain their original source,
settings, usage and failure labels. Never call an execution receipt a quality
parity receipt, or infer per-task subscription percentage from token counts.

No ChatGPT relay, paid API fallback, auth-cache copying or unrelated connector
repair is introduced. User sessions, queues, drafts, paging originals and failed
diagnostics must survive the verified installer and subsequent tests.
