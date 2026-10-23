# Retained owner-control retrospective adoption

Status: implementation proposal and synthetic regression evidence. No actual
recovery, install, model call, parity result, or provider authorization is claimed
by this document.

## Two time scopes, one original Core owner

An original task contract's execution lease is not renewed. A separate current
`adoption_permit` can authorize proof-only reconciliation of the exact already
finished, read-only owner collection. This is temporal-scope/adoption enforcement
repair using existing RCC rules, not a new foundational primitive.

Only the existing authenticated loopback `operator.write`
`os1.rcc.recoverOwnerControl` method accepts this operation. JSON fields do not
establish authentication: there is no `approved: true` or claimed issuer field.
The operator must explicitly issue the permit within the user's actual authorized
repair scope. The existing gateway authenticates the invocation; the pinned host
validates the supplied bindings. The host's structural acceptance is not an
independent proof of caller authentication.

The permit binds its own recovery ID, task ID, immutable original request,
expected revision/fingerprint/snapshot, source fingerprint, original parent
contract/checker, context/tree/reference policy, owner policy source/projection,
owner collection manifest, historical runtime archive, and each ordered child's
attempt/native receipt/witness/contract/checker hashes. Its current lease is at
most 300 seconds, with generation, dispatch and retry counts exactly zero and
parity explicitly `unverified`. Neither registry contracts nor original output,
receipt, witness, usage, attempt, or failed event is changed.

The original unexpired recovery path still works without a permit. A permit is
required when old execution authority is expired. A supplied malformed or expired
permit fails closed even if the original lease is still valid.

## Historical evidence and current facts

No caller supplies a historical `now`. For each retained child the host obtains
`configuredInputObservation.preparedAtMS` and the original immutable saved
checker receipt's `observedAt`. It validates the C1 binding and requires:

```
old parent issued <= prepared <= original checker observed < old parent expiry
old child issued  <= prepared <= original checker observed < old child expiry
original checker observed <= actual current time
```

The unchanged `TaskQualityEvidence.evaluate` evaluates the original child receipt
at that receipt's real observation time. A new current permit does not turn a
late or missing original receipt into valid history.

`retainedCollectionFact` is recovery-only. The normal `fact` default, catalog,
model admission, generation, continuation and retry expiry checks are unchanged.
Core's recovery path extracts the old collection's shape only after validating
the current permit; the host independently establishes historical validity.

This first implementation is bounded to collections whose original registered
parent/child leases also overlap the selected original child-checker epoch. The
parent uses the first retained child epoch for this common collection identity
check; each child separately proves its own prepared/observed ordering. Valid
but non-overlapping historical leases may be conservatively rejected. This is not
a claim that arbitrary expired tasks or independent historical schedules can be
recovered.

Current account, owner policy, original sources/tree, contracts/checkers, native
receipts/witnesses/control and historical runtime custody remain checked before
and after awaited work. Archive bytes are only inspected, not executed. Native
SDK, planner, routing, adapter, generation, retry, new lease or usage settlement
callbacks are not reachable through the recovery method.

## Parent verification occurs now

The deterministic frozen parent checker runs now against the original retained
ordered child outputs. It receives an **in-memory verification-only contract**
with the original contract's exact bindings, scope, obligations, coverage,
checker and reference state; only issued/expiry dates come from the new permit.
This derived contract is never written to the registry, offered by a catalog, or
used for execution.

The private parent checker receipt labels:

- original contract SHA-256;
- derived verification contract and SHA-256;
- adoption permit SHA-256;
- actual captured current observation timestamp;
- zero generation/dispatch/retry and unverified parity.

It does not backdate the parent check into the old execution lease. Current
permit validity is checked again after the checker and before Core's exact
snapshot CAS. Expiry, cancellation, revision/source/evidence changes, unknown
control grammar, tools, or checker failure preserve the held state. Same-request
idempotent retrieval of an already-adopted result is not another adoption or
another model execution.

Cross-language permit/historical-runtime hashes use recursive key-sorted JSON,
UTF-8, unescaped `/` (Swift sortedKeys + withoutEscapingSlashes, Core stable
JSON.stringify). Hash labels describe these canonical objects, not arbitrary
pretty-printed file bytes. Original task/contract hash formats are unchanged.

## Verification and limits

Executed locally with synthetic material only:

- `node --test scripts/fixtures/openclaw-rcc-retained-control.test.mjs`: 78 tests,
  including current exact permit plus expired original, no permit, 28 malformed
  binding/mode/time cases, expiry during awaited parent proof, and ordinary
  expired execution still denied. Fake host results are explicitly not proof of
  real historical filesystem/native control.
- `python3 scripts/test-owner-retrospective-permit.py`: 133 extracted-source
  temporal/shape/lease checks using the real unchanged TaskQualityEvidence
  evaluator; includes invalid original timing, C1 failure, original/current
  evaluator distinction, unchanged semantic fields and slash/Unicode hash.
- `python3 scripts/test-owner-retained-control.py`: 96 existing custody/gateway
  checks including optional permit transport shape and current lease.
- `swift build --target OS1 --jobs 2`: actual OS1 target compilation succeeds.

This is not an actual Core recovery receipt. Root must review, integrate and
qualify the installed artifacts, then issue the real fresh narrow permit through
the existing authenticated owner. Actual candidate final-lock, external grading,
resource comparison and product completion remain separate gates.

## Legacy collection-manifest identity bridge

A real429 proof-only recovery was rejected because its new permit validator used
operational-witness JSON encoding (unescaped `/`) to recompute an OLD collection
manifest, whose `fact` encoder used sorted keys with escaped `/`. These are two
separate identity domains. The original request/catalog/contract manifest was
correct and remains unchanged; the rejected/expired permit is not revived.

Both `fact` and permit validation now call the one
`collectionManifestSHA256` helper, which preserves the exact original sorted-key
JSONEncoder format. No second/alternative manifest hash is accepted. Operational
witness encoding and cross-language permit/historical-runtime canonicalization
are unchanged. Required old obligations, source guards, current permit lease,
historical execution lease, custody and adoption checks are not weakened.

The former temporal94 component harness did not execute the actual
`validateAdoptionPermit` body. The extended133-check harness now invokes that
body with the real OwnerCollection type, slash/backslash/quote/Unicode variants,
original-versus-operational hashes, changed-spec rejection, and nullable Contract
encoding separation. It explicitly rejects the alternative manifest rather than
migrating source data. Synthetic tests do not constitute actual recovery proof.
