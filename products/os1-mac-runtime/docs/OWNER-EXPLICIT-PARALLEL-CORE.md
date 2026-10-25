# Owner-explicit read-only parallel topology — Core enforcement

## Observed failure and preserved boundary

The actual installed434 A4 request explicitly asked for two independent A/B
workers. The local proposal contained one A-diag node. Core accepted that
one-node graph, then its existing indivisible-instruction lock restored the
entire original request as that worker's instruction. The locked answer contains
both A and B. Therefore this is a topology/task-tree/parallelism failure, not
proof that B was absent from the final output. Source repair does not grade the
answer or retroactively rewrite that failed trace.

The mechanism is an existing owner-constraint/adoption enforcement gap: a model
proposal could collapse an explicit source partition before the authoritative
execution graph was built. No new foundational RCC primitive is introduced.

## Narrow supported source contract

`deriveExplicitParallelOwnerContract` is a pure, conservative source adapter.
Only a bounded, unambiguous, explicitly parallel independent labelled partition
of 2–4 units, under current effective read-only scope, can produce this contract.
Unsupported, quoted, ambiguous, effectful or over-bound forms return null. This
is not a complete natural-language intent/permission parser and not a universal
parallel-planning claim.

Since K5 (`ROUTING-ARCHITECTURE-V2-FROZEN.md` §5, K5 row) Core derives it
whenever the host builds the plan (`hostAutoPlan`), under
`ownerExplicitParallelEligible`: ordinary Auto, original objective, admission
facts present (`owner_scope`), current effective read-only scope, no registered
owner collection and a bound policy projection. It no longer depends on the
bounded Auto flag, the adaptive mode, a class certificate, a verifier registry
or the native ceiling: the partition is the owner's topology, not a planner or
quality claim, and every unit still binds by the one admission law. A class
certificate does not certify a unit (a unit is not the original request), so a
unit binds the reference; a native ceiling binds each unit to the owner's
maximum words; an applicable registered `sound_full` verifier gives each unit a
certified descent whose reference escalation is fixed at bind. An older catalog
without admission facts keeps the original indivisible request.

A FULL task contract and a partition cannot coexist. Core holds the task as
`owner_partition_contract_conflict` before any planner call or plan write, and
`assertOwnerExplicitParallelPlan` enforces the same exclusion, so a catalog
refresh that gains a contract holds at the ticket boundary. Writer and
explicit-route paths do not borrow this policy. The default `hostPlan` remains
unchanged unless the owning Core explicitly supplies its owner-partition option.

## Same owner, same scheduler, immutable source

For a supported contract, Core creates every exact owner unit in source order:

- stable `owner_parallel_N` identity;
- no dependencies, read-only scope, no owned paths;
- exact original global prefix plus exact assigned source section;
- a host assignment telling the worker to perform only this unit, while all
  constraints elsewhere in the original request remain binding;
- all original material references;
- `final_node_id: null` for an all-unit ordered collection.

Every native ticket still carries the complete original request/objective in
its existing immutable `original_request` / `original_objective` fields.
Its assigned-unit `objective` / `instruction` remain distinct from that floor. No original request, policy, source fingerprint,
host context, catalog hash or permission profile is rewritten. Source spans
prove text partition identity, not complete semantic global-constraint coverage.

The local planner is never asked for an owner partition (K5). The adaptive
observation returns before any proposal in every adaptive mode and records a
`plan_proposal` `not_needed` resource event (reason
`owner_explicit_parallel_partition`), so `plan_model_calls` is an observed 0.
`admitBoundedAutoPlan` rejects a proposal for a partitionable task with
`bounded_owner_partition_not_planner_owned`, and Core does not adopt an earlier
observed proposal for it. There are therefore no model candidate-ID hints: each
unit's row is bound by the host admission law (`resolveRoutePlan`), with current
scope/account/tools/quota/availability checks. No model-authored dependency,
paraphrase or final-owner selection replaces the host graph.

For tasks without a supported partition the strict V2 decoder and P1 compiler
are unchanged and a malformed/unsupported proposal remains rejected by P1. This
does not introduce a new maximum model default or a new cheap-quality
certificate. Unsupported source syntax retains the original prior behavior.

All work uses the existing Core scheduler, task budgets, pool reservations,
leases, cancellation, retry and source-freshness checks. Independent node
structure does not prove actual concurrency: worker limits, quota and resource
availability still govern it. Real concurrency must be observed separately.

## Output and evidence

Core activates this contract through its explicit host-plan owner-partition
option and source path, not by recognizing a node-name prefix. Legacy, explicit
and externally planned plans using the same spelling retain prior behavior; a
FULL contract holds as above. The newly admitted contract is
then recorded as Core-owned snapshot metadata and revalidated before every
actual native ticket and final collection, then labels each completed child's raw output with the corresponding
owner label in source order. It does not summarize the children through another
LLM or promote execution-only output into task/quality/parity certification.

Snapshot metadata distinguishes source-structural unit coverage from unverified
semantic coverage and quality. `local_proposal_admitted` is kept for schema
compatibility and is always false since K5, because no proposal is asked or
adopted for a partition. Proposed model topology, where a planner runs for
other tasks, remains an untrusted observation rather than being relabelled the
executed graph.

Pure fixtures use real temporary Core SQLite plus canned planner/native
callbacks. They are regression tests, not provider runs, quota savings,
installed-App proof or quality-equivalence measurements. Root separately owns
any future installed qualification and its finite generation ledger.

## Evidence-guided method

Public abstracts re-inspected for this repair:
[ReAct](https://arxiv.org/abs/2210.03629) motivates a bounded observation/action
feedback loop; [intrinsic self-correction limitations](https://arxiv.org/abs/2310.01798)
support using external source/structural checks instead of model agreement as
adoption evidence. These are design inputs, not proof that this implementation
works. Local pure tests and later executed runtime receipts provide that proof
at their respective scopes.

## Corrective review history

The first Core candidate used a name-prefix test during generic plan validation.
Independent review found that an old custom plan could legitimately use that
name without the new feature. That candidate is preserved but not approved
alone. Its corrective commit removes prefix-as-provenance, uses the explicit
Core activation path plus stored source-contract metadata, and adds legacy,
FULL and certificate compatibility and actual ticket-boundary mutation tests.

A subsequent payload-boundary review found that validating the stored plan alone
was insufficient: a caller could pass a different actual node object to ticket
preparation. The next corrective commit compares actual source-owned node
fields with the canonical current unit (and preserves read-only authority),
while still allowing legitimate candidate-only rebinding. The original plan
and earlier review receipts remain preserved; new negative fixtures keep the
snapshot unchanged and mutate only the actual ticket argument.

K5 on the one-law branch then decoupled the partition from the bounded planner
boundary described in the earlier text: eligibility, the contract hold and the
no-planner path are as stated above, and the frozen routing document's K5 row
records the deviations and behavior changes.
