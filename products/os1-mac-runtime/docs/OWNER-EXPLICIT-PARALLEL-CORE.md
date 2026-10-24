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

Core uses it only within the existing bounded Auto eligibility boundary:
ordinary Auto, original objective, no FULL task contract, no class certificate,
no registered owner collection and no explicit maximum/reference ceiling.
Existing certified/FULL/live-capability/writer/explicit-route paths do not borrow
this policy. The default `hostPlan` remains unchanged unless the owning Core
explicitly supplies its bounded owner-partition option.

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

The strict V2 decoder and P1 compiler are unchanged. Once a compiled proposal
passes those existing gates, model nodes provide optional candidate-ID hints
only. A hint is associated with a unit only by an exact unit label or host unit
ID. Missing, merged, extra or ambiguous locators do not discard units or reuse
an arbitrary sibling's positional hint. They use the existing bounded null-hint
candidate policy, with current scope/account/tools/quota/availability checks.
No model-authored dependency, paraphrase or final-owner selection replaces the
host graph.

A malformed/unsupported proposal remains rejected by P1. The old host reference
fallback is retained; when the owner partition itself is supported, that
fallback still retains all exact units. This does not introduce a new maximum
model default or a new cheap-quality certificate. Unsupported source syntax
retains the original prior behavior.

All work uses the existing Core scheduler, task budgets, pool reservations,
leases, cancellation, retry and source-freshness checks. Independent node
structure does not prove actual concurrency: worker limits, quota and resource
availability still govern it. Real concurrency must be observed separately.

## Output and evidence

Core activates this contract through its explicit bounded feature/source path,
not by recognizing a node-name prefix. Legacy/FULL/cert/explicit/feature-off plans
using the same spelling retain prior behavior. The newly admitted contract is
then recorded as Core-owned snapshot metadata and revalidated before every
actual native ticket and final collection, then labels each completed child's raw output with the corresponding
owner label in source order. It does not summarize the children through another
LLM or promote execution-only output into task/quality/parity certification.

Snapshot metadata distinguishes source-structural unit coverage from unverified
semantic coverage and quality. `local_proposal_admitted` records only that the
existing local-proposal path passed; it does not assert that any tuple hint was
uniquely mapped or used. Proposed model topology remains an untrusted
observation rather than being relabelled the executed graph.

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
